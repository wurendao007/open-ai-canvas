const INVALID_FILE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Keeps a user-visible asset name, adding an extension only when needed. */
export function buildAssetDownloadFileName(name: string, extension: string, fallback = "asset") {
    const normalizedName = String(name || "").trim().replace(INVALID_FILE_NAME_CHARS, "_").replace(/[. ]+$/g, "") || fallback;
    if (/\.[a-z0-9]{1,12}$/i.test(normalizedName)) return normalizedName;
    const normalizedExtension = String(extension || "bin").trim().replace(/^\.+/, "") || "bin";
    return `${normalizedName}.${normalizedExtension}`;
}
