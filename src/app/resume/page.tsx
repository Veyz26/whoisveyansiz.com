import type { Metadata } from "next";
import { CvDocument, CvToolbar } from "@/components/cv/CvDocument";

export const metadata: Metadata = {
  title: "CV — Veyansiz Chetty",
  description: "The full CV of Veyansiz Chetty, Platform Engineer specialising in site reliability and DevOps.",
};

export default function FullCv() {
  return (
    <div className="cv-page">
      <CvToolbar pdf="/resume/Veyansiz-Chetty-CV.pdf" other={{ href: "/resume/one-page/", label: "One-page version" }} />
      <CvDocument variant="full" />
    </div>
  );
}
