import { ModeToggle } from "@/components/ui/mode-toggle";
import { UserButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <>
      <div>Hello world </div>
      <ModeToggle></ModeToggle>
      <UserButton/>
    </>
  );
}
