export interface OrgNode {
  id: string;
  name: string;
  parent?: string;
  specialist?: string;
}
export interface OrgChart {
  version: 1;
  nodes: OrgNode[];
  assignments: Record<string,string>;
}
export interface OrgAccount { id: string; name: string; role: 'admin'|'member' }
export function below(chart: OrgChart, ancestor: string, target: string): boolean {
  const nodes=new Map(chart.nodes.map(n=>[n.id,n]));
  const seen=new Set<string>();
  let node=nodes.get(target);
  while(node?.parent && !seen.has(node.id)) {
    seen.add(node.id);
    if(node.parent===ancestor) return target!==ancestor;
    node=nodes.get(node.parent);
  }
  return false;
}
export function allowedSpecialists(chart: OrgChart, account: string): string[] {
  const position=chart.assignments[account];
  if(!position) return [];
  return chart.nodes.filter(n=>n.specialist && below(chart,position,n.id)).map(n=>n.specialist!);
}
