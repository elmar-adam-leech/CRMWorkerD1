import { ThemeToggle } from '../ThemeToggle';
import { ThemeProvider } from '../ThemeProvider';

export default function ThemeToggleExample() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="example-theme">
      <div className="p-6">
        <div className="flex items-center gap-4">
          <span className="text-sm">Toggle theme:</span>
          <ThemeToggle />
        </div>
      </div>
    </ThemeProvider>
  );
}