import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthShareMetadata,
  createPublicShareMetadata,
  createRobotsPolicy,
  createSitemapEntries,
  isPublicLandingEnabled,
} from "./social-preview";

test("the public landing is enabled only when the production flag is on", () => {
  assert.equal(isPublicLandingEnabled({ COMING_SOON: "true" }), true);
  assert.equal(isPublicLandingEnabled({ NEXT_PUBLIC_COMING_SOON: "true" }), true);
  assert.equal(isPublicLandingEnabled({ COMING_SOON: "false" }), false);
  assert.equal(isPublicLandingEnabled({}), false);
});

test("the login URL has a share image and does not point canonical to the homepage", () => {
  const metadata = createAuthShareMetadata(true);
  // Canonical should NOT point to root https://deskrpg.com/ when robots has noindex
  assert.equal(metadata.alternates?.canonical, "https://deskrpg.com/auth");
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.equal(metadata.openGraph?.url, "https://deskrpg.com/");
  assert.equal((metadata.twitter as { card?: string })?.card, "summary_large_image");
});

test("robots policy protects private /account/ paths", () => {
  const publicRules = createRobotsPolicy(true);
  const rules = Array.isArray(publicRules.rules) ? publicRules.rules[0] : publicRules.rules;
  const disallow = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];
  assert.ok(disallow.includes("/account/"));
});

test("robots and sitemap index only the one public site page", () => {
  const publicRules = createRobotsPolicy(true);
  assert.deepEqual(publicRules.rules, {
    userAgent: "*",
    allow: "/",
    disallow: [
      "/auth",
      "/api/",
      "/admin/",
      "/account/",
      "/channels",
      "/characters",
      "/game",
      "/gateways",
      "/profiles",
      "/ui2-review",
    ],
  });
  assert.equal(publicRules.sitemap, "https://deskrpg.com/sitemap.xml");
  const entries = createSitemapEntries(true);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, "https://deskrpg.com/");
  assert.ok(entries[0].lastModified instanceof Date);
  assert.equal(entries[0].changeFrequency, "weekly");
  assert.equal(entries[0].priority, 1.0);
  assert.deepEqual(entries[0].alternates?.languages, {
    ko: "https://deskrpg.com/?lang=ko",
    en: "https://deskrpg.com/?lang=en",
    ja: "https://deskrpg.com/?lang=ja",
    zh: "https://deskrpg.com/?lang=zh",
  });

  assert.deepEqual(createRobotsPolicy(false).rules, { userAgent: "*", disallow: "/" });
  assert.deepEqual(createSitemapEntries(false), []);
});

test("share metadata provides the canonical URL and a large image as absolute addresses", () => {
  const metadata = createPublicShareMetadata();

  assert.equal(metadata.alternates?.canonical, "https://deskrpg.com/");
  assert.equal(metadata.openGraph?.url, "https://deskrpg.com/");
  assert.equal((metadata.openGraph as { type?: string })?.type, "website");
  assert.equal((metadata.twitter as { card?: string })?.card, "summary_large_image");
  assert.deepEqual(metadata.robots, { index: true, follow: true });

  const images = metadata.openGraph?.images;
  assert.ok(Array.isArray(images));
  assert.deepEqual(images?.[0], {
    url: "https://deskrpg.com/assets/social/og",
    width: 1200,
    height: 630,
    alt: "DeskRPG for Hermes 3D office with AI coworkers",
  });
  assert.ok(Array.isArray(metadata.twitter?.images));
  assert.equal(metadata.twitter.images[0], "https://deskrpg.com/assets/social/og");
  assert.match(String(metadata.title), /DeskRPG for Hermes/);
  assert.match(String(metadata.description), /Hermes/);
});

test("the public share copy stays the Korean copy the landing page advertises (og:locale ko_KR)", () => {
  const metadata = createPublicShareMetadata();
  assert.equal(metadata.title, "DeskRPG for Hermes — AI 직원이 일하는 사무실");
  assert.equal(
    metadata.description,
    "Hermes 에이전트와 함께 대화하고, 회의하고, 칸반 작업을 진행하는 셀프호스팅 3D 가상 오피스.",
  );
  assert.equal(metadata.openGraph?.locale, "ko_KR");
});
