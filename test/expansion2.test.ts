import { describe, expect, it } from "vitest";
import { fired, scanTmp } from "./helpers";

/**
 * Fixtures for expansion round 2: Google's retired surfaces, Meta version
 * expiry, Azure ADAL, Firebase runtime config, legacy SDKs (Sentry, PayPal,
 * boto), and the first Go entries. Both directions per entry, as always.
 */

const pkg = (deps: Record<string, string>) =>
  JSON.stringify({ dependencies: deps });

/* ------------------------------ Google trio ------------------------------ */

describe("Google Sign-In platform library", () => {
  it("fires on gapi.auth2 and the platform.js include; GIS stays silent", () => {
    const bad = scanTmp({
      "src/auth.js": "const auth = gapi.auth2.getAuthInstance();\n",
    });
    expect(fired(bad, "google-signin-platform-library")).toBe(true);

    const script = scanTmp({
      "src/page.tsx":
        'const src = "https://apis.google.com/js/platform.js";\n',
    });
    expect(fired(script, "google-signin-platform-library")).toBe(true);

    const good = scanTmp({
      "src/page.tsx":
        'const src = "https://accounts.google.com/gsi/client";\n',
    });
    expect(fired(good, "google-signin-platform-library")).toBe(false);
  });
});

describe("Universal Analytics", () => {
  it("fires on analytics.js, ga('create'), and UA- ids; GA4 stays silent", () => {
    const a = scanTmp({
      "src/ga.js": 'load("https://www.google-analytics.com/analytics.js");\n',
    });
    expect(fired(a, "google-universal-analytics-retired")).toBe(true);

    const b = scanTmp({ "src/ga.js": "ga('create', 'UA-1234567-2', 'auto');\n" });
    expect(fired(b, "google-universal-analytics-retired")).toBe(true);

    const good = scanTmp({
      "src/ga.js":
        'load("https://www.googletagmanager.com/gtag/js?id=G-ABC123");\n',
    });
    expect(fired(good, "google-universal-analytics-retired")).toBe(false);
  });
});

describe("google.maps.Marker", () => {
  it("fires on the legacy class, not on AdvancedMarkerElement", () => {
    const bad = scanTmp({
      "src/map.js": "const m = new google.maps.Marker({ position });\n",
    });
    expect(fired(bad, "google-maps-marker-deprecated")).toBe(true);

    const good = scanTmp({
      "src/map.js":
        "const m = new google.maps.marker.AdvancedMarkerElement({ position });\n",
    });
    expect(fired(good, "google-maps-marker-deprecated")).toBe(false);
  });
});

/* ------------------------------- Meta ------------------------------- */

describe("Meta Graph API legacy versions", () => {
  it("fires on v2–v19 urls; current versions stay silent", () => {
    const old1 = scanTmp({
      "src/fb.ts": 'fetch("https://graph.facebook.com/v17.0/me");\n',
    });
    expect(fired(old1, "meta-graph-api-legacy-versions")).toBe(true);

    const old2 = scanTmp({
      "src/fb.ts": 'fetch("https://graph.facebook.com/v9.0/me");\n',
    });
    expect(fired(old2, "meta-graph-api-legacy-versions")).toBe(true);

    const current = scanTmp({
      "src/fb.ts": 'fetch("https://graph.facebook.com/v25.0/me");\n',
    });
    expect(fired(current, "meta-graph-api-legacy-versions")).toBe(false);

    const templated = scanTmp({
      "src/fb.ts": "fetch(`https://graph.facebook.com/${version}/me`);\n",
    });
    expect(fired(templated, "meta-graph-api-legacy-versions")).toBe(false);
  });
});

/* ---------------------------- SDK-mode entries ---------------------------- */

describe("legacy SDK packages", () => {
  it("ADAL fires (npm and PyPI); MSAL does not", () => {
    const js = scanTmp({ "package.json": pkg({ "adal-node": "^0.2.4" }) });
    expect(fired(js, "azure-adal-retired")).toBe(true);

    const py = scanTmp({ "requirements.txt": "adal==1.2.7\n" });
    expect(fired(py, "azure-adal-retired")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@azure/msal-node": "^2.0.0" }),
    });
    expect(fired(good, "azure-adal-retired")).toBe(false);
  });

  it("Protractor fires; WebdriverIO does not", () => {
    const bad = scanTmp({
      "package.json": JSON.stringify({ devDependencies: { protractor: "^7.0.0" } }),
    });
    expect(fired(bad, "protractor-eol")).toBe(true);

    const good = scanTmp({
      "package.json": JSON.stringify({ devDependencies: { webdriverio: "^9.0.0" } }),
    });
    expect(fired(good, "protractor-eol")).toBe(false);
  });

  it("Raven fires (js and python); unified Sentry SDKs do not", () => {
    const js = scanTmp({ "package.json": pkg({ raven: "^2.6.4" }) });
    expect(fired(js, "sentry-raven-legacy")).toBe(true);

    const py = scanTmp({ "requirements.txt": "raven==6.10.0\n" });
    expect(fired(py, "sentry-raven-legacy")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@sentry/node": "^8.0.0" }),
      "requirements.txt": "sentry-sdk==2.0.0\n",
    });
    expect(fired(good, "sentry-raven-legacy")).toBe(false);
  });

  it("paypal-rest-sdk fires (npm and PyPI); current server SDK does not", () => {
    const js = scanTmp({ "package.json": pkg({ "paypal-rest-sdk": "^1.8.1" }) });
    expect(fired(js, "paypal-rest-sdk-deprecated")).toBe(true);

    const py = scanTmp({ "requirements.txt": "paypalrestsdk==1.13.3\n" });
    expect(fired(py, "paypal-rest-sdk-deprecated")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@paypal/paypal-server-sdk": "^1.0.0" }),
    });
    expect(fired(good, "paypal-rest-sdk-deprecated")).toBe(false);
  });

  it("boto v2 fires; boto3 does not", () => {
    const bad = scanTmp({ "requirements.txt": "boto==2.49.0\n" });
    expect(fired(bad, "aws-boto2-archived")).toBe(true);

    const good = scanTmp({ "requirements.txt": "boto3==1.34.0\n" });
    expect(fired(good, "aws-boto2-archived")).toBe(false);
  });

  it("request-promise wrappers fire via the extended request entry", () => {
    const rp = scanTmp({ "package.json": pkg({ "request-promise": "^4.2.6" }) });
    expect(fired(rp, "request-package-deprecated")).toBe(true);

    const rpn = scanTmp({
      "package.json": pkg({ "request-promise-native": "^1.0.9" }),
    });
    expect(fired(rpn, "request-package-deprecated")).toBe(true);
  });
});

/* ------------------------------ Go entries ------------------------------ */

const GO_MOD = (modules: string[]) =>
  ["module example.com/app", "", "go 1.22", "", "require (", ...modules.map((m) => `\t${m}`), ")", ""].join("\n");

describe("Go module entries (first go.mod coverage)", () => {
  it("jwt-go fires; golang-jwt does not", () => {
    const bad = scanTmp({
      "go.mod": GO_MOD(["github.com/dgrijalva/jwt-go v3.2.0+incompatible"]),
    });
    expect(fired(bad, "go-jwt-go-deprecated")).toBe(true);

    const good = scanTmp({
      "go.mod": GO_MOD(["github.com/golang-jwt/jwt/v5 v5.2.1"]),
    });
    expect(fired(good, "go-jwt-go-deprecated")).toBe(false);
  });

  it("golang/protobuf fires; google.golang.org/protobuf does not", () => {
    const bad = scanTmp({
      "go.mod": GO_MOD(["github.com/golang/protobuf v1.5.4"]),
    });
    expect(fired(bad, "go-golang-protobuf-deprecated")).toBe(true);

    const good = scanTmp({
      "go.mod": GO_MOD(["google.golang.org/protobuf v1.34.0"]),
    });
    expect(fired(good, "go-golang-protobuf-deprecated")).toBe(false);
  });
});

/* --------------------------- pattern-mode, gated --------------------------- */

describe("Firebase functions.config()", () => {
  it("fires with firebase-functions imported; params API and ungated stay silent", () => {
    const bad = scanTmp({
      "src/index.ts":
        'import * as functions from "firebase-functions";\n' +
        "const key = functions.config().stripe.key;\n",
    });
    expect(fired(bad, "firebase-functions-config-shutdown")).toBe(true);

    const good = scanTmp({
      "src/index.ts":
        'import { defineString } from "firebase-functions/params";\n' +
        'const key = defineString("STRIPE_KEY");\n',
    });
    expect(fired(good, "firebase-functions-config-shutdown")).toBe(false);

    const ungated = scanTmp({
      "src/other.ts": "const c = app.functions.config();\n",
    });
    expect(fired(ungated, "firebase-functions-config-shutdown")).toBe(false);
  });
});

describe("Hugging Face legacy inference endpoint", () => {
  it("fires on the dead hostname, not on the router", () => {
    const bad = scanTmp({
      "src/hf.py":
        'URL = "https://api-inference.huggingface.co/models/gpt2"\n',
    });
    expect(fired(bad, "huggingface-legacy-inference-api")).toBe(true);

    const good = scanTmp({
      "src/hf.py": 'URL = "https://router.huggingface.co/hf-inference"\n',
    });
    expect(fired(good, "huggingface-legacy-inference-api")).toBe(false);
  });
});
