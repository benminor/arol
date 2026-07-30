import { describe, expect, it } from "vitest";
import { fired, scanTmp } from "./helpers";

/**
 * Fixtures for expansion round 3: high-usage vendors (Shopify, Supabase,
 * Auth0, Auth.js, Segment, Cloudflare, Square, AWS CDK, LaunchDarkly, etc.).
 * Both directions per entry where practical.
 */

const pkg = (deps: Record<string, string>) =>
  JSON.stringify({ dependencies: deps });

const devPkg = (deps: Record<string, string>) =>
  JSON.stringify({ devDependencies: deps });

/* ------------------------------ Shopify ------------------------------ */

describe("Shopify Scripts", () => {
  it("fires on Script Editor Input/Output.cart; plain Ruby stays silent", () => {
    const bad = scanTmp({
      "scripts/discount.rb":
        "Input.cart.line_items.each do |line_item|\n  Output.cart = Input.cart\nend\n",
    });
    expect(fired(bad, "shopify-scripts-sunset")).toBe(true);

    const good = scanTmp({
      "lib/cart.rb": "class Cart\n  def total; @items.sum; end\nend\n",
    });
    expect(fired(good, "shopify-scripts-sunset")).toBe(false);
  });
});

describe("Shopify ScriptTag API", () => {
  it("fires on scriptTagCreate and /script_tags; theme extensions stay silent", () => {
    const bad = scanTmp({
      "src/app.ts": "await client.request(scriptTagCreate, { src });\n",
    });
    expect(fired(bad, "shopify-script-tags")).toBe(true);

    const rest = scanTmp({
      "src/app.ts": 'await fetch("/admin/api/2024-01/script_tags.json");\n',
    });
    expect(fired(rest, "shopify-script-tags")).toBe(true);

    const good = scanTmp({
      "src/app.ts": 'import { themeAppExtension } from "./theme";\n',
    });
    expect(fired(good, "shopify-script-tags")).toBe(false);
  });
});

describe("Shopify REST Admin API", () => {
  it("fires on REST product urls and restResources; GraphQL stays silent", () => {
    const bad = scanTmp({
      "src/shopify.ts":
        'const url = "/admin/api/2024-01/products.json";\n',
    });
    expect(fired(bad, "shopify-rest-admin-legacy")).toBe(true);

    const restImport = scanTmp({
      "src/shopify.ts":
        'import { restResources } from "@shopify/shopify-api/rest/admin/2024-01";\n',
    });
    expect(fired(restImport, "shopify-rest-admin-legacy")).toBe(true);

    const good = scanTmp({
      "src/shopify.ts":
        'const url = "/admin/api/2024-01/graphql.json";\n',
    });
    expect(fired(good, "shopify-rest-admin-legacy")).toBe(false);
  });
});

describe("Shopify koa auth packages", () => {
  it("fires on @shopify/koa-shopify-auth; shopify-app-express does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "@shopify/koa-shopify-auth": "^5.0.3" }),
    });
    expect(fired(bad, "shopify-koa-auth-deprecated")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@shopify/shopify-app-express": "^5.0.0" }),
    });
    expect(fired(good, "shopify-koa-auth-deprecated")).toBe(false);
  });
});

/* ------------------------------ Auth stack ------------------------------ */

describe("Supabase auth-helpers", () => {
  it("fires on auth-helpers-nextjs; @supabase/ssr does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "@supabase/auth-helpers-nextjs": "^0.10.0" }),
    });
    expect(fired(bad, "supabase-auth-helpers")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@supabase/ssr": "^0.5.0" }),
    });
    expect(fired(good, "supabase-auth-helpers")).toBe(false);
  });
});

describe("Auth0 nextjs v3 APIs", () => {
  it("fires on handleAuth when the SDK is imported; Auth0Client alone does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "@auth0/nextjs-auth0": "^3.5.0" }),
      "src/pages/api/auth/[...auth0].ts":
        'import { handleAuth } from "@auth0/nextjs-auth0";\nexport default handleAuth();\n',
    });
    expect(fired(bad, "auth0-nextjs-v3-apis")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@auth0/nextjs-auth0": "^4.0.0" }),
      "src/lib/auth0.ts":
        'import { Auth0Client } from "@auth0/nextjs-auth0/server";\nexport const auth0 = new Auth0Client();\n',
    });
    expect(fired(good, "auth0-nextjs-v3-apis")).toBe(false);
  });
});

describe("Auth.js legacy adapters + getServerSession", () => {
  it("fires on @next-auth/prisma-adapter; @auth/prisma-adapter does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "@next-auth/prisma-adapter": "^1.0.7" }),
    });
    expect(fired(bad, "next-auth-legacy-adapters")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@auth/prisma-adapter": "^2.0.0" }),
    });
    expect(fired(good, "next-auth-legacy-adapters")).toBe(false);
  });

});

/* ------------------------------ Analytics / infra SDKs ------------------------------ */

describe("Segment analytics-node", () => {
  it("fires on analytics-node; @segment/analytics-node does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "analytics-node": "^6.2.0" }),
    });
    expect(fired(bad, "segment-analytics-node")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@segment/analytics-node": "^2.0.0" }),
    });
    expect(fired(good, "segment-analytics-node")).toBe(false);
  });
});

describe("Cloudflare Wrangler v1", () => {
  it("fires on @cloudflare/wrangler; wrangler does not", () => {
    const bad = scanTmp({
      "package.json": devPkg({ "@cloudflare/wrangler": "^1.19.0" }),
    });
    expect(fired(bad, "cloudflare-wrangler-v1")).toBe(true);

    const good = scanTmp({
      "package.json": devPkg({ wrangler: "^3.0.0" }),
    });
    expect(fired(good, "cloudflare-wrangler-v1")).toBe(false);
  });
});

describe("Square Connect SDK", () => {
  it("fires on square-connect; square does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "square-connect": "^6.20201216.0" }),
    });
    expect(fired(bad, "square-connect-sdk")).toBe(true);

    const good = scanTmp({ "package.json": pkg({ square: "^39.0.0" }) });
    expect(fired(good, "square-connect-sdk")).toBe(false);
  });
});

describe("Babel polyfill", () => {
  it("fires on @babel/polyfill; core-js does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "@babel/polyfill": "^7.12.1" }),
    });
    expect(fired(bad, "babel-polyfill-deprecated")).toBe(true);

    const good = scanTmp({ "package.json": pkg({ "core-js": "^3.38.0" }) });
    expect(fired(good, "babel-polyfill-deprecated")).toBe(false);
  });
});

describe("Axios CancelToken", () => {
  it("fires on axios.CancelToken when axios is imported; AbortSignal stays silent", () => {
    const bad = scanTmp({
      "package.json": pkg({ axios: "^1.7.0" }),
      "src/api.ts":
        'import axios from "axios";\nconst source = axios.CancelToken.source();\n',
    });
    expect(fired(bad, "axios-cancel-token")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ axios: "^1.7.0" }),
      "src/api.ts":
        'import axios from "axios";\nconst c = new AbortController();\nawait axios.get(url, { signal: c.signal });\n',
    });
    expect(fired(good, "axios-cancel-token")).toBe(false);
  });
});

describe("react-query rename", () => {
  it("fires on react-query; @tanstack/react-query does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "react-query": "^3.39.3" }),
    });
    expect(fired(bad, "react-query-package-rename")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@tanstack/react-query": "^5.0.0" }),
    });
    expect(fired(good, "react-query-package-rename")).toBe(false);
  });
});

describe("Apollo legacy packages", () => {
  it("fires on apollo-boost; @apollo/client does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "apollo-boost": "^0.4.9" }),
    });
    expect(fired(bad, "apollo-legacy-packages")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@apollo/client": "^3.11.0" }),
    });
    expect(fired(good, "apollo-legacy-packages")).toBe(false);
  });
});

describe("AWS CDK v1", () => {
  it("fires on @aws-cdk/core; aws-cdk-lib does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "@aws-cdk/core": "^1.204.0" }),
    });
    expect(fired(bad, "aws-cdk-v1-eol")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "aws-cdk-lib": "^2.160.0" }),
    });
    expect(fired(good, "aws-cdk-v1-eol")).toBe(false);
  });
});

describe("LaunchDarkly legacy Node SDKs", () => {
  it("fires on launchdarkly-node-server-sdk; scoped package does not", () => {
    const bad = scanTmp({
      "package.json": pkg({ "launchdarkly-node-server-sdk": "^7.0.4" }),
    });
    expect(fired(bad, "launchdarkly-legacy-node-sdks")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "@launchdarkly/node-server-sdk": "^9.0.0" }),
    });
    expect(fired(good, "launchdarkly-legacy-node-sdks")).toBe(false);
  });
});

describe("discord.js pre-v14", () => {
  it("fires on discord.js ^13; v14 stays silent", () => {
    const bad = scanTmp({
      "package.json": pkg({ "discord.js": "^13.17.0" }),
    });
    expect(fired(bad, "discord-js-pre-v14")).toBe(true);

    const good = scanTmp({
      "package.json": pkg({ "discord.js": "^14.16.0" }),
    });
    expect(fired(good, "discord-js-pre-v14")).toBe(false);
  });
});

describe("enzyme", () => {
  it("fires on enzyme; @testing-library/react does not", () => {
    const bad = scanTmp({
      "package.json": devPkg({
        enzyme: "^3.11.0",
        "enzyme-adapter-react-16": "^1.15.0",
      }),
    });
    expect(fired(bad, "enzyme-abandoned")).toBe(true);

    const good = scanTmp({
      "package.json": devPkg({ "@testing-library/react": "^16.0.0" }),
    });
    expect(fired(good, "enzyme-abandoned")).toBe(false);
  });
});
