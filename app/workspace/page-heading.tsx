export function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div><span className="page-badge"><span aria-hidden="true" /> พื้นที่ทำงานส่วนตัว</span></div>;
}
