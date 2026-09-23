import HelpContent from "@/components/HelpContent";

// Authenticated Help destination (More -> Help for signed-in users). Lives
// under /account, so it's already covered by middleware.ts's existing
// `path.startsWith("/account")` protection -- no new auth implementation,
// no custom redirect logic. Deliberately renders no wrapper of its own:
// AppShell (root layout) already supplies the sidebar/bottom-nav/mobile
// header for every (app) route, and HelpContent already supplies its own
// "Help" heading -- adding a page-level title here would just duplicate it.
export default function AccountHelpPage() {
  return (
    <div className="space-y-6">
      <HelpContent />
    </div>
  );
}
