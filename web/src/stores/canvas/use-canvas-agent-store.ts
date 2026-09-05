import { create } from "zustand";

type CanvasAgentStore = {
    confirmTools: boolean;
    setAgentState: (patch: Partial<Pick<CanvasAgentStore, "confirmTools">>) => void;
};

export const useCanvasAgentStore = create<CanvasAgentStore>((set) => ({
    confirmTools: true,
    setAgentState: (patch) => set(patch),
}));
