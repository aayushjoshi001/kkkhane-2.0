const fs = require('fs');
const path = require('path');

const map = {
  Button: "import Button from '@/components/ui/Button'",
  Card: "import Card from '@/components/ui/Card'",
  StatCard: "import StatCard from '@/components/ui/StatCard'",
  EmptyState: "import EmptyState from '@/components/ui/EmptyState'",
  Skeleton: "import Skeleton from '@/components/ui/Skeleton'",
  TableChip: "import TableChip from '@/components/ui/TableChip'",
  OrderCard: "import OrderCard from '@/components/ui/OrderCard'",
  FeedSection: "import FeedSection from '@/components/ui/FeedSection'",
  CommandPaletteMount: "import CommandPaletteMount from '@/components/ui/CommandPaletteMount'",
  AgingTimer: "import AgingTimer from '@/components/ui/AgingTimer'",
  Badge: "import { Badge } from '@/components/ui/Badge'",
  StatusBadge: "import { StatusBadge } from '@/components/ui/Badge'",
  statusMeta: "import { statusMeta } from '@/components/ui/Badge'",
  StatCardSkeleton: "import { StatCardSkeleton } from '@/components/ui/Skeleton'",
  RowSkeleton: "import { RowSkeleton } from '@/components/ui/Skeleton'",
  CommandPalette: "import { CommandPalette } from '@/components/ui/CommandPalette'",
  CommandHint: "import { CommandHint } from '@/components/ui/CommandHint'",
  openCommandPalette: "import { openCommandPalette } from '@/components/ui/CommandHint'",
  COMMAND_OPEN_EVENT: "import { COMMAND_OPEN_EVENT } from '@/components/ui/CommandHint'",
  NepaliInput: "import { NepaliInput } from '@/components/ui/NepaliInput'",
  NepaliTextArea: "import { NepaliTextArea } from '@/components/ui/NepaliInput'"
};

const files = [
  "src/app/(admin)/admin/billing/checkout/page.tsx",
  "src/app/(admin)/admin/billing/packages/page.tsx",
  "src/app/(admin)/admin/billing/pending/page.tsx",
  "src/app/(admin)/admin/dashboard/page.tsx",
  "src/components/admin/MenuManager.tsx",
  "src/components/kitchen/OrderQueue.tsx",
  "src/components/kitchen/TakeoutQueue.tsx",
  "src/components/waiter/ActiveSessionsList.tsx",
  "src/components/waiter/CashPaymentFeed.tsx",
  "src/components/waiter/CashierTableManager.tsx",
  "src/components/waiter/FloorStats.tsx",
  "src/components/waiter/OrderConfirmFeed.tsx",
  "src/components/waiter/PaymentVerificationFeed.tsx",
  "src/components/waiter/ServiceRequestFeed.tsx",
  "src/components/waiter/TableManager.tsx",
  "src/components/waiter/WaiterCustomerTabs.tsx",
  "src/components/waiter/WaiterDeliveryFeed.tsx",
  "src/components/waiter/WaiterOrderFeed.tsx",
  "src/components/waiter/WaiterTakeoutFeed.tsx"
];

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Find import { A, B } from '@/components/ui'
  // Handle multiline imports
  const regex = /import\s*\{([\s\S]*?)\}\s*from\s*['"]@\/components\/ui\/?['"]/g;
  
  let hasChanges = false;
  content = content.replace(regex, (match, p1) => {
    hasChanges = true;
    const imports = p1.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const newImports = [];
    imports.forEach(imp => {
      // Handle "X as Y" if any, though likely not present. Let's assume basic imports.
      let name = imp.split(' ')[0]; // e.g. Button
      if (map[name]) {
        newImports.push(map[name]);
      } else {
        // Fallback if not mapped
        newImports.push(`import { ${imp} } from '@/components/ui' // TODO: FIX`);
      }
    });
    // Consolidate named imports from the same file
    const fileMap = {};
    const defaultImports = [];
    newImports.forEach(ni => {
      const matchNamed = ni.match(/import\s*\{\s*([^\}]+)\s*\}\s*from\s*(.*)/);
      if (matchNamed) {
        const file = matchNamed[2];
        const val = matchNamed[1];
        if (!fileMap[file]) fileMap[file] = [];
        fileMap[file].push(val);
      } else {
        defaultImports.push(ni);
      }
    });
    const finalImports = [...defaultImports];
    for (const [file, vals] of Object.entries(fileMap)) {
      finalImports.push(`import { ${vals.join(', ')} } from ${file}`);
    }
    return finalImports.join('\n');
  });
  
  if (hasChanges) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${file}`);
  }
});
