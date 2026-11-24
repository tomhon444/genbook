import type { Metadata } from "next";
import "@coreui/coreui/dist/css/coreui.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ระบบออกเลขหนังสือราชการ | คณะวิศวกรรมศาสตร์",
  description: "พื้นที่ทำงานระบบออกเลขหนังสือราชการ คณะวิศวกรรมศาสตร์ มหาวิทยาลัยสงขลานครินทร์",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="th"><body>{children}</body></html>;
}
