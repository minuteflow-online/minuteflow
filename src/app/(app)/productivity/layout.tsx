import ProductivitySubNav from "@/components/ProductivitySubNav";

export default function ProductivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <ProductivitySubNav />
      {children}
    </div>
  );
}
