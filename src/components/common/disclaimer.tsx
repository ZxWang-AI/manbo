type DisclaimerKind = "ai-assessment" | "legal-reference" | "user-decision";

const disclaimerCopy: Record<DisclaimerKind, string> = {
  "ai-assessment": "AI 只做初步整理，不作法律认定，也不代表事实已经核实。",
  "legal-reference": "法律信息仅作导航；法域、版本和适用性需要由你与专业机构进一步核对。",
  "user-decision": "是否继续、修改、保存、删除或对外联系，始终由你决定。",
};

export function Disclaimer({ kind }: { kind: DisclaimerKind }) {
  return (
    <p className="disclaimer" data-disclaimer={kind}>
      {disclaimerCopy[kind]}
    </p>
  );
}
