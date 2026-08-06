import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://oss.greenways.ai",
  base: "/historia",
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [
    starlight({
      title: "Historia",
      description: "Git-native temporal memory for code, conversations, and agent context.",
      logo: { src: "./public/sigil.svg", replacesTitle: false },
      favicon: "https://oss.greenways.ai/visual-language/favicons/historia.svg",
      customCss: [
        "./src/styles/custom.css",
        "./src/styles/starlight-shell.css",
      ],
      components: {
        Header: "./src/components/SharedSiteHeader.astro",
        ThemeProvider: "./src/components/GreenwaysThemeProvider.astro",
        ThemeSelect: "./src/components/GreenwaysThemeSelect.astro"
      },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/greenways-ai/historia" }],
      editLink: { baseUrl: "https://github.com/greenways-ai/historia/edit/main/site/" },
      lastUpdated: true,
      pagefind: true,
      sidebar: [
        { label: "Overview", slug: "index" },
        { label: "Conversation memory", items: [
          { label: "Historia Collect", slug: "collect" },
          { label: "Install the browser bridge", slug: "collect/install" },
          { label: "Browser collection", slug: "collect/browser" },
          { label: "Privacy & data handling", slug: "collect/privacy" },
          { label: "Local application", slug: "collect/app" },
          { label: "CLI agent context", slug: "collect/cli-agents" },
          { label: "Text graphs", slug: "concepts/text-graphs" }
        ]},
        { label: "Code history", items: [
          { label: "Install & quick start", slug: "getting-started" },
          { label: "Multiple repositories", slug: "getting-started/multiple-repositories" },
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
          { label: "Releases & binaries", slug: "reference/releases" },
          { label: "npm publishing", slug: "reference/npm-publishing" },
          { label: "Analyzer protocol", slug: "reference/analyzer-protocol" },
          { label: "Agent skill", slug: "reference/agent-skill" }
        ]},
        { label: "Project", items: [
          { label: "Source ↗", link: "https://github.com/greenways-ai/historia" },
          { label: "Greenways ↗", link: "https://oss.greenways.ai/historia/" }
        ]}
      ],
      head: [
        { tag: "meta", attrs: { property: "og:image", content: "https://opensource.greenways.ai/historia/images/historian-raven-day.webp" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } }
      ]
    }),
    mdx()
  ]
});
