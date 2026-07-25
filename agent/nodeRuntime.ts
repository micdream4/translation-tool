import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const runtime = globalThis as Record<string, unknown>;

runtime.DOMParser ??= DOMParser as unknown;
runtime.XMLSerializer ??= XMLSerializer as unknown;
