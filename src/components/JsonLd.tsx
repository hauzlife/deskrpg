export default function JsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": "https://deskrpg.com/#application",
        name: "DeskRPG for Hermes",
        operatingSystem: "Web, Self-Hosted (Docker)",
        applicationCategory: "BusinessApplication",
        description:
          "A self-hosted 3D virtual office where you chat, meet, and run kanban work with Hermes AI agents.",
        url: "https://deskrpg.com",
        author: {
          "@type": "Organization",
          name: "Dante Labs",
          url: "https://dante-labs.com",
        },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
      },
      {
        "@type": "WebSite",
        "@id": "https://deskrpg.com/#website",
        url: "https://deskrpg.com",
        name: "DeskRPG for Hermes",
        inLanguage: ["ko-KR", "en-US", "ja-JP", "zh-CN"],
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
