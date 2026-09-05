import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

import { scopedStorageKey } from "@/lib/user-scope";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

/**
 * localforage 的 setDriver 失败分支（node_modules/localforage/dist/localforage.js:2760-2765）
 * 会把实例的 `_driverSet` 替换成一个刚创建、还没有任何处理器的 rejected promise。
 * 它要等到该实例的**第二次** API 调用（ready() 重新挂接到新 promise）才会被处理；
 * 从未被调用或只被调用过一次的实例会把这个 rejection 永久留在事件循环里。
 * 在 Bun 测试（indexedDB / localStorage / window 全部 undefined）和 SSR 预渲染等
 * 无存储环境里，它会被运行时记成未处理 rejection，并随机记到当时正在运行的
 * 用例头上——表现为跨文件、看似随机、单独跑却全绿的失败。
 *
 * 这里在实例构造后立刻给“初始 _driverSet”挂一个 catch：该回调在 setDriver 的
 * catch 分支（也就是新 rejected promise 被创建）之后运行，此时调用 ready()
 * 即可为新 promise 挂上处理器，整个清理都发生在同一轮微任务内。
 *
 * 注意这只是记账清理，不改变任何业务行为：
 * - getItem/setItem/removeItem 的拒绝照常向调用方传播（真实存储故障不会被吞掉）；
 * - user-scoped-generation-persistence.test.ts:108 钉住的“失败必须传播”契约不受影响
 *   （该用例直接桩掉实例方法，根本不走 ready()）。
 */
function neutralizeDriverProbeRejection(instance: LocalForage): void {
    const initialDriverSet = (instance as unknown as { _driverSet?: Promise<unknown> | null })._driverSet;
    if (!initialDriverSet) return;
    void initialDriverSet.catch(() => {
        void instance.ready().catch(() => undefined);
    });
}

neutralizeDriverProbeRejection(localforage);

export function createLazyLocalForage(options: LocalForageOptions): () => LocalForage {
    let instance: LocalForage | null = null;
    return () => {
        if (!instance) {
            instance = localforage.createInstance(options);
            neutralizeDriverProbeRejection(instance);
        }
        return instance;
    };
}

export function localForageStorageForScope(scope?: string): StateStorage {
    const keyFor = (name: string) => scopedStorageKey(name, scope);
    return {
        getItem: async (name) => {
            if (typeof window === "undefined") return null;
            return (await localforage.getItem<string>(keyFor(name))) || null;
        },
        setItem: async (name, value) => {
            if (typeof window === "undefined") return;
            await localforage.setItem(keyFor(name), value);
        },
        removeItem: async (name) => {
            if (typeof window === "undefined") return;
            await localforage.removeItem(keyFor(name));
        },
    };
}

export const localForageStorage: StateStorage = localForageStorageForScope();
