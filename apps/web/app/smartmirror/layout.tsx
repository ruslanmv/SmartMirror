import { MirrorShell } from "@/components/MirrorShell";

import "./mirror.css";
import "./persistent-capture.css";

export default function SmartMirrorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Apply TV-scale typography before first paint (older WebViews lack :has()). */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('mirror-root')" }} />
      <MirrorShell>{children}</MirrorShell>
    </>
  );
}
