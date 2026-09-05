import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { DEFAULT_SERVER_URL, normalizeServerUrl, serverUrl } from "../src/remote-config.js";

const originalServerUrl = process.env.KRAFTREEL_SERVER_URL;
const originalLegacyServerUrl = process.env.YINGCE_SERVER_URL;

afterEach(() => {
    if (originalServerUrl === undefined) delete process.env.KRAFTREEL_SERVER_URL;
    else process.env.KRAFTREEL_SERVER_URL = originalServerUrl;
    if (originalLegacyServerUrl === undefined) delete process.env.YINGCE_SERVER_URL;
    else process.env.YINGCE_SERVER_URL = originalLegacyServerUrl;
});

describe("remote server configuration", () => {
    test("uses the hosted KraftReel URL when no override is supplied", () => {
        delete process.env.KRAFTREEL_SERVER_URL;
        delete process.env.YINGCE_SERVER_URL;
        assert.equal(DEFAULT_SERVER_URL, "https://kraftreel.com");
        assert.equal(serverUrl(), DEFAULT_SERVER_URL);
    });

    test("keeps an explicit HTTPS URL as an override", () => {
        process.env.KRAFTREEL_SERVER_URL = "https://self-hosted.example.test/";
        assert.equal(serverUrl(), "https://self-hosted.example.test");
    });

    test("rejects insecure or credential-bearing overrides", () => {
        assert.throws(() => normalizeServerUrl("http://kraftreel.com"), /HTTPS/);
        assert.throws(() => normalizeServerUrl("https://user:pass@kraftreel.com"), /凭据/);
    });
});
