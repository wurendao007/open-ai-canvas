export type RemoteCanvasEnvelope<T> = {
    code: number;
    data: T;
    msg: string;
};

export type RemoteCanvasProject = {
    id: string;
    projectId?: string;
    title: string;
    payload: Record<string, unknown>;
    revision: number;
    stateHash: string;
    createdAt: string;
    updatedAt: string;
};

export type RemoteCanvasPrecondition = {
    revision: number;
    stateHash: string;
};
