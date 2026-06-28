import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

export function renderMarkdownLines(text: string, width: number): string[] {
  const md = new Markdown(text, 0, 0, getMarkdownTheme());
  return md.render(Math.max(1, width));
}
