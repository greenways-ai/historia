import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://historian.greenways.ai",
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [
    starlight({
      title: "Historian",
      description: "Git-native temporal code indexing, history, lineage, and structural similarity.",
      logo: { src: "./public/favicon.svg", replacesTitle: false },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/custom.css"],
      components: {
        ThemeProvider: "./src/components/GreenwaysThemeProvider.astro",
        ThemeSelect: "./src/components/GreenwaysThemeSelect.astro"
      },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/greenways-ai/historian" }],
      editLink: { baseUrl: "https://github.com/greenways-ai/historian/edit/main/site/" },
      lastUpdated: true,
      pagefind: true,
      sidebar: [
        { label: "Overview", slug: "index" },
        { label: "Getting started", items: [
          { label: "Install & quick start", slug: "getting-started" },
          { label: "Multiple repositories", slug: "getting-started/multiple-repositories" }
        ]},
        { label: "Concepts", items: [
          { label: "Temporal index", slug: "concepts/temporal-index" },
          { label: "Lineage & retrieval", slug: "concepts/lineage-retrieval" }
        ]},
        { label: "Analyzers", items: [
          { label: "Languages", slug: "analyzers/languages" },
          { label: "Authoring & conformance", slug: "analyzers/authoring" }
        ]},
        { label: "Operations", slug: "operations" },
        { label: "Reference", items: [
          { label: "CLI", slug: "reference/cli" },
          { label: "Analyzer protocol", slug: "reference/analyzer-protocol" },
          { label: "Agent skill", slug: "reference/agent-skill" }
        ]},
        { label: "Project", items: [
          { label: "Source ↗", link: "https://github.com/greenways-ai/historian" },
          { label: "Greenways ↗", link: "https://greenways.ai/opensource/historian/" }
        ]}
      ],
      head: [
        { tag: "meta", attrs: { property: "og:image", content: "https://historian.greenways.ai/images/historian-raven-day.webp" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } }
      ]
    }),
    mdx()
  ]
});
