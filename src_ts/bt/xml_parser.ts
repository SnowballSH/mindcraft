// xml_parser.ts converts a BehaviorTree XML document (in a simplified BehaviorTree.CPP-like style) 
//               into an Intermediate Representation (IR):

// Input: XML string like:
// xml
// <BehaviorTree ID="foo">
//   <Sequence>
//     <Condition name="has_item" item="{item}" count="{count}" />
//     <Action name="give_player" player="{player}" item="{item}" count="{count}" />
//   </Sequence>
// </BehaviorTree>

// Output: an IRTree:
// ts
// {
//   rootId: "root",
//   nodes: {
//     "root": { type: "Sequence", children: ["root/0", "root/1"], ... },
//     "root/0": { type: "Condition", name: "has_item", params: {...} },
//     "root/1": { type: "Action", name: "give_player", params: {...} },
//   }
// }
// This IR is what the interpreter (interpreter.ts) ticks over.


import { XMLParser } from 'fast-xml-parser';
import type { IRNode, IRTree } from './types.js';

export interface ParseOptions {
  treeId?: string;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function getTagKey(node: any): string {
  const keys = Object.keys(node).filter((k) => k !== ':@');
  if (keys.length !== 1) {
    throw new Error(`Invalid XML node shape, expected single tag key. Keys: ${keys.join(', ')}`);
  }
  return keys[0];
}

function getAttrs(node: any): Record<string, unknown> {
  const attrs = node[':@'] as Record<string, unknown> | undefined;
  return attrs ?? {};
}

function getChildren(node: any): any[] {
  const tag = getTagKey(node);
  const children = node[tag];
  return asArray<any>(children);
}

function normalizeParams(attrs: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!attrs) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'name' || k === 'ID') continue;
    // fast-xml-parser returns numbers as strings unless configured.
    // Keep as string here; action schema validation can coerce.
    out[k] = v;
  }
  return out;
}

function nodeId(parentId: string, idx: number): string {
  return `${parentId}/${idx}`;
}

function parseBTNode(
  raw: any,
  id: string,
  nodes: Record<string, IRNode>,
): string {
  const tagName = getTagKey(raw);
  const attrs = getAttrs(raw);
  const childrenRaw = getChildren(raw);

  if (tagName === 'Sequence' || tagName === 'Fallback') {
    const childrenIds: string[] = [];
    for (let i = 0; i < childrenRaw.length; i++) {
      const childId = nodeId(id, i);
      const parsedChildId = parseBTNode(childrenRaw[i], childId, nodes);
      childrenIds.push(parsedChildId);
    }
    nodes[id] = {
      id,
      type: tagName,
      children: childrenIds,
      params: normalizeParams(attrs),
    } as IRNode;
    return id;
  }

  if (tagName === 'Action') {
    const name = String(attrs?.name ?? '');
    if (!name) throw new Error(`Action at ${id} missing required attribute 'name'`);
    nodes[id] = {
      id,
      type: 'Action',
      name,
      params: normalizeParams(attrs),
    } as IRNode;
    return id;
  }

  if (tagName === 'Condition') {
    const name = String(attrs?.name ?? '');
    if (!name) throw new Error(`Condition at ${id} missing required attribute 'name'`);
    nodes[id] = {
      id,
      type: 'Condition',
      name,
      params: normalizeParams(attrs),
    } as IRNode;
    return id;
  }

  throw new Error(`Unsupported BT XML tag '${tagName}' at ${id}`);
}

export function parseBehaviorTreeXml(xml: string, opts: ParseOptions = {}): IRTree {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    attributesGroupName: ':@',
    preserveOrder: true,
    trimValues: true,
  });

  const parsed = parser.parse(xml);

  // Expect something like:
  // <BehaviorTree ID="foo"> <Sequence> ... </Sequence> </BehaviorTree>
  const btTags = parsed.filter((n: any) => getTagKey(n) === 'BehaviorTree');
  if (btTags.length === 0) {
    throw new Error('No <BehaviorTree> root tag found');
  }

  const chosen = btTags[0];
  const btAttrs = getAttrs(chosen);
  const idFromXml = btAttrs?.ID ? String(btAttrs.ID) : undefined;
  if (opts.treeId && idFromXml && opts.treeId !== idFromXml) {
    // allow selecting by ID later; for now just sanity check
  }

  const children = getChildren(chosen);
  if (children.length !== 1) {
    throw new Error(`<BehaviorTree> must contain exactly 1 root node, got ${children.length}`);
  }

  const nodes: Record<string, IRNode> = {};
  const rootId = 'root';
  parseBTNode(children[0], rootId, nodes);
  return { rootId, nodes };
}
