import type { Metadata } from "next";
import { CvDocument, CvToolbar } from "@/components/cv/CvDocument";

export const metadata: Metadata = {
  title: "One-page CV — Veyansiz Chetty",
  description: "A one-page CV of Veyansiz Chetty, Platform Engineer specialising in site reliability and DevOps.",
};

export default function OnePageCv() {
  return (
    <div className="cv-page">
      <CvToolbar pdf="/resume/Veyansiz-Chetty-CV-one-page.pdf" other={{ href: "/resume/", label: "Full version" }} />
      <CvDocument variant="one-page" />
    </div>
  );
}
