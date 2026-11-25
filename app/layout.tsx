import type { Metadata } from "next";
// Red Wyvern UI Kit: load order font.css -> coreui-theme.min.css -> kit.css, then app styles.
import "../public/red-wyvern-ui-kit/css/font.css";
import "../public/red-wyvern-ui-kit/css/coreui-theme.min.css";
import "../public/red-wyvern-ui-kit/css/kit.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ระบบออกเลขหนังสือ | คณะวิศวกรรมศาสตร์",
  description: "พื้นที่ทำงานระบบออกเลขหนังสือ คณะวิศวกรรมศาสตร์ มหาวิทยาลัยสงขลานครินทร์",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="th"><body>{children}</body></html>;
}
