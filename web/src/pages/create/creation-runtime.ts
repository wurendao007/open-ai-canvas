export { createGenerationBatchRetryContexts, createGenerationRetryContext, runGenerationOperationOnce } from "@/lib/canvas/canvas-project-generation";
export { isGenerationTaskCancelled, runBackendGenerationTask, runBackendGenerationTaskBatch } from "@/services/api/generation-task";
export { subscribeGenerationTasks } from "@/services/api/task-center";
// 本地 Runtime 已移除；保留创建页恢复协议的兼容判定，但不会触发本机调用。
export function isLocalDreaminaWaitStopped() { return false; }
export function localDreaminaCancellationMessage() { return "已停止"; }
export { uploadMediaFile } from "@/services/file-storage";
export { uploadImage } from "@/services/image-storage";
export { consumeGenerationTaskMessage, generationTaskMaterializedUrls, materializeGenerationTaskAssets, projectGenerationTaskResult } from "@/services/project-asset-sync";
export { applyGenerationConsumerEffect } from "@/services/generation-consumer-dedupe";
export { beginGenerationConsumer, runGenerationConsumer } from "@/services/generation-consumer-lifecycle";
export { recoverCreationTextTask } from "@/services/creation-text-task-recovery";
export { skillRuntime } from "@/services/skill-runtime";
