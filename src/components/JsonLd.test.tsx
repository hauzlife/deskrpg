import assert from "node:assert/strict";
import test from "node:test";
import JsonLd from "./JsonLd";

test("JsonLd component outputs valid Schema.org graph with SoftwareApplication and WebSite", () => {
  const element = JsonLd();
  assert.equal(element.type, "script");
  assert.equal(element.props.type, "application/ld+json");

  const rawJson = element.props.dangerouslySetInnerHTML?.__html;
  assert.ok(rawJson, "JSON-LD script must contain HTML payload");

  const parsed = JSON.parse(rawJson);
  assert.equal(parsed["@context"], "https://schema.org");
  assert.ok(Array.isArray(parsed["@graph"]));

  const app = parsed["@graph"].find(
    (node: { "@type": string }) => node["@type"] === "SoftwareApplication",
  );
  assert.ok(app, "Must contain SoftwareApplication schema");
  assert.equal(app.name, "DeskRPG for Hermes");
  assert.equal(app.url, "https://deskrpg.com");
  assert.equal(app.applicationCategory, "BusinessApplication");

  const website = parsed["@graph"].find((node: { "@type": string }) => node["@type"] === "WebSite");
  assert.ok(website, "Must contain WebSite schema");
  assert.equal(website.name, "DeskRPG for Hermes");
  assert.equal(website.url, "https://deskrpg.com");
  assert.ok(Array.isArray(website.inLanguage));
});
