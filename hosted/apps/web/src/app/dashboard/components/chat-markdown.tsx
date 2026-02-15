function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^mailto:/i.test(value)) return value;
  return null;
}

function renderInlineMarkdown(input: string): string {
  const codeBlocks: string[] = [];
  let text = escapeHtml(input);

  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const token = `__CODE_${codeBlocks.length}__`;
    codeBlocks.push(`<code>${code}</code>`);
    return token;
  });

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, hrefRaw: string) => {
    const href = sanitizeHref(hrefRaw);
    if (!href) return label;
    return `<a href="${href}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/_([^_]+)_/g, "<em>$1</em>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return text.replace(/__CODE_(\d+)__/g, (_match, indexRaw: string) => {
    const index = Number(indexRaw);
    return codeBlocks[index] ?? "";
  });
}

function renderBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let paragraphLines: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let listType: "ul" | "ol" | null = null;

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    const content = paragraphLines.map((line) => renderInlineMarkdown(line)).join("<br />");
    html.push(`<p>${content}</p>`);
    paragraphLines = [];
  }

  function flushList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  }

  for (const rawLine of lines) {
    const line = rawLine ?? "";
    const fenceMatch = line.match(/^```/);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
      } else {
        const code = escapeHtml(codeLines.join("\n"));
        html.push(`<pre><code>${code}</code></pre>`);
        inCodeBlock = false;
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const content = renderInlineMarkdown(headingMatch[2]);
      html.push(`<h${level}>${content}</h${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderInlineMarkdown(quoteMatch[1])}</blockquote>`);
      continue;
    }

    const ulMatch = line.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${renderInlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${renderInlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  if (inCodeBlock) {
    const code = escapeHtml(codeLines.join("\n"));
    html.push(`<pre><code>${code}</code></pre>`);
  }
  flushParagraph();
  flushList();
  return html.join("");
}

function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  return renderBlocks(markdown);
}

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div
      className="text-sm leading-relaxed break-words [overflow-wrap:anywhere] [&_a]:underline [&_a:hover]:opacity-90 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:opacity-90 [&_code]:rounded [&_code]:bg-black/20 [&_code]:px-1 [&_code]:py-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/25 [&_pre]:p-3 [&_pre]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:font-semibold [&_h3]:mb-1 [&_p+p]:mt-2"
      dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
    />
  );
}
