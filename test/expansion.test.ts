import { describe, expect, it } from "vitest";
import { fired, scanTmp } from "./helpers";

/**
 * Fixtures for the high-hit-rate expansion batch (abandoned packages + dated
 * web-API sunsets). Every entry gets both directions: the deprecated thing
 * fires, its modern neighbor stays silent.
 */

const pkg = (deps: Record<string, string>) =>
  JSON.stringify({ dependencies: deps });

const devPkg = (deps: Record<string, string>) =>
  JSON.stringify({ devDependencies: deps });

/* ---------------- maintainer-abandoned packages (sdk mode) ---------------- */

describe("abandoned npm packages fire on manifest presence", () => {
  it("request fires; axios does not", () => {
    const bad = scanTmp({ "package.json": pkg({ request: "^2.88.2" }) });
    expect(fired(bad, "request-package-deprecated")).toBe(true);

    const good = scanTmp({ "package.json": pkg({ axios: "^1.7.0" }) });
    expect(fired(good, "request-package-deprecated")).toBe(false);
  });

  it("moment fires; dayjs and moment-timezone alone do not", () => {
    const bad = scanTmp({ "package.json": pkg({ moment: "^2.30.1" }) });
    expect(fired(bad, "momentjs-maintenance-mode")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ dayjs: "^1.11.0", "moment-timezone": "^0.5.45" }),
    });
    expect(fired(good, "momentjs-maintenance-mode")).toBe(false);
  });

  it("react-scripts (CRA) fires; vite does not", () => {
    const bad = scanTmp({ "package.json": pkg({ "react-scripts": "5.0.1" }) });
    expect(fired(bad, "create-react-app-sunset")).toBe(true);

    const good = scanTmp({ "package.json": devPkg({ vite: "^6.0.0" }) });
    expect(fired(good, "create-react-app-sunset")).toBe(false);
  });

  it("node-sass fires; sass (Dart Sass) does not", () => {
    const bad = scanTmp({ "package.json": devPkg({ "node-sass": "^9.0.0" }) });
    expect(fired(bad, "node-sass-eol")).toBe(true);

    const good = scanTmp({ "package.json": devPkg({ sass: "^1.80.0" }) });
    expect(fired(good, "node-sass-eol")).toBe(false);
  });

  it("tslint fires; typescript-eslint does not", () => {
    const bad = scanTmp({ "package.json": devPkg({ tslint: "^6.1.3" }) });
    expect(fired(bad, "tslint-deprecated")).toBe(true);

    const good = scanTmp({
      "package.json": devPkg({ "typescript-eslint": "^8.0.0" }),
    });
    expect(fired(good, "tslint-deprecated")).toBe(false);
  });

  it("karma fires; vitest does not", () => {
    const bad = scanTmp({ "package.json": devPkg({ karma: "^6.4.0" }) });
    expect(fired(bad, "karma-deprecated")).toBe(true);

    const good = scanTmp({ "package.json": devPkg({ vitest: "^4.0.0" }) });
    expect(fired(good, "karma-deprecated")).toBe(false);
  });
});

/* --------------------- dated EOLs (sdk / version mode) --------------------- */

describe("framework EOLs", () => {
  it("AngularJS ('angular') fires; @angular/core does not", () => {
    const bad = scanTmp({ "package.json": pkg({ angular: "^1.8.3" }) });
    expect(fired(bad, "angularjs-eol")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@angular/core": "^18.0.0" }),
    });
    expect(fired(good, "angularjs-eol")).toBe(false);
  });

  it("vue@2 fires; vue@3 does not; unparseable version stays conservative", () => {
    const bad = scanTmp({ "package.json": pkg({ vue: "^2.7.16" }) });
    expect(fired(bad, "vue-2-eol")).toBe(true);

    const good = scanTmp({ "package.json": pkg({ vue: "^3.4.0" }) });
    expect(fired(good, "vue-2-eol")).toBe(false);

    const unknown = scanTmp({ "package.json": pkg({ vue: "latest" }) });
    expect(fired(unknown, "vue-2-eol")).toBe(false);
  });

  it("eslint@8 fires; eslint@9 does not", () => {
    const bad = scanTmp({ "package.json": devPkg({ eslint: "^8.57.0" }) });
    expect(fired(bad, "eslint-8-eol")).toBe(true);

    const good = scanTmp({ "package.json": devPkg({ eslint: "^9.20.0" }) });
    expect(fired(good, "eslint-8-eol")).toBe(false);
  });
});

/* ------------------------- pattern-mode entries ------------------------- */

describe("distutils removal (Python)", () => {
  it("fires on real imports", () => {
    const a = scanTmp({ "setup.py": "from distutils.core import setup\n" });
    expect(fired(a, "python-distutils-removed")).toBe(true);

    const b = scanTmp({ "build.py": "import distutils.spawn\n" });
    expect(fired(b, "python-distutils-removed")).toBe(true);
  });

  it("stays silent on setuptools and on comments", () => {
    const good = scanTmp({ "setup.py": "from setuptools import setup\n" });
    expect(fired(good, "python-distutils-removed")).toBe(false);

    const comment = scanTmp({
      "note.py": "# TODO: we dropped 'from distutils' imports long ago\nx = 1\n",
    });
    expect(fired(comment, "python-distutils-removed")).toBe(false);
  });
});

describe("new Buffer() (Node DEP0005)", () => {
  it("fires on the constructor, not on Buffer.from/alloc or comments", () => {
    const bad = scanTmp({ "src/io.js": "const b = new Buffer(10);\n" });
    expect(fired(bad, "node-buffer-constructor-deprecated")).toBe(true);

    const good = scanTmp({
      "src/io.js": "const b = Buffer.from('x');\nconst c = Buffer.alloc(10);\n",
    });
    expect(fired(good, "node-buffer-constructor-deprecated")).toBe(false);

    const comment = scanTmp({
      "src/io.js": "// used to be: new Buffer(10)\nconst b = Buffer.alloc(10);\n",
    });
    expect(fired(comment, "node-buffer-constructor-deprecated")).toBe(false);
  });
});

describe("Slack files.upload retirement", () => {
  it("fires with the SDK imported, JS and Python spellings", () => {
    const js = scanTmp({
      "src/bot.ts":
        'import { WebClient } from "@slack/web-api";\n' +
        "const client = new WebClient(token);\n" +
        'await client.files.upload({ channels: "C123", file });\n',
    });
    expect(fired(js, "slack-files-upload-retired")).toBe(true);

    const py = scanTmp({
      "bot.py":
        "import slack_sdk\n" +
        "client = slack_sdk.WebClient(token)\n" +
        'client.files_upload(channels="C123", file=f)\n',
    });
    expect(fired(py, "slack-files-upload-retired")).toBe(true);
  });

  it("stays silent on the v2 replacement and without the SDK import", () => {
    const v2 = scanTmp({
      "bot.py":
        "import slack_sdk\n" +
        "client = slack_sdk.WebClient(token)\n" +
        'client.files_upload_v2(channel="C123", file=f)\n',
    });
    expect(fired(v2, "slack-files-upload-retired")).toBe(false);

    const ungated = scanTmp({
      "src/unrelated.ts": "const route = ctx.files.upload;\n",
    });
    expect(fired(ungated, "slack-files-upload-retired")).toBe(false);
  });
});

describe("Firebase Dynamic Links shutdown", () => {
  it("fires on the REST endpoint and the React Native package", () => {
    const rest = scanTmp({
      "src/links.ts":
        'const url = "https://firebasedynamiclinks.googleapis.com/v1/shortLinks?key=" + key;\n',
    });
    expect(fired(rest, "firebase-dynamic-links-shutdown")).toBe(true);

    const rn = scanTmp({
      "src/app.tsx":
        'import dynamicLinks from "@react-native-firebase/dynamic-links";\n',
    });
    expect(fired(rn, "firebase-dynamic-links-shutdown")).toBe(true);
  });

  it("stays silent in apps without the integration", () => {
    const good = scanTmp({
      "src/app.tsx": 'import analytics from "@react-native-firebase/analytics";\n',
    });
    expect(fired(good, "firebase-dynamic-links-shutdown")).toBe(false);
  });
});
