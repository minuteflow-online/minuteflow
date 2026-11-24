import { redirect } from "next/navigation";

// Same as the staff /productivity: open on Assignment.
export default function ClientProductivityIndexPage() {
  redirect("/client/productivity/assignment");
}
