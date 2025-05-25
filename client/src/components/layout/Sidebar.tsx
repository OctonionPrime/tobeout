import { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  CalendarDays, 
  Utensils, 
  Users, 
  BarChart3,
  Store, 
  Bot, 
  Settings, 
  Puzzle,
  Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  active?: boolean;
}

const NavItem = ({ href, icon, children, active }: NavItemProps) => (
  <Link href={href}>
    <a 
      className={cn(
        "flex items-center px-6 py-3 text-gray-700 hover:bg-gray-50",
        active && "bg-blue-50 border-r-4 border-blue-500"
      )}
    >
      <div className={cn("w-5", active ? "text-blue-500" : "text-gray-400")}>
        {icon}
      </div>
      <span className="mx-3">{children}</span>
    </a>
  </Link>
);

export function Sidebar() {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h1 className="text-2xl font-semibold text-gray-800">ToBeOut</h1>
          <p className="text-sm text-gray-500">Restaurant Management</p>
        </div>

        <nav className="flex-1 pt-4 pb-4 overflow-y-auto">
          <div className="px-4 mb-2">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Main</h2>
          </div>
          <NavItem href="/dashboard" icon={<LayoutDashboard size={18} />} active={location === "/dashboard"}>
            Dashboard
          </NavItem>
          <NavItem href="/reservations" icon={<CalendarDays size={18} />} active={location === "/reservations"}>
            Reservations
          </NavItem>
          <NavItem href="/tables" icon={<Utensils size={18} />} active={location === "/tables"}>
            Tables
          </NavItem>
          <NavItem href="/guests" icon={<Users size={18} />} active={location === "/guests"}>
            Guests
          </NavItem>
          <NavItem href="/analytics" icon={<BarChart3 size={18} />} active={location === "/analytics"}>
            Analytics
          </NavItem>

          <div className="px-4 mt-6 mb-2">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Settings</h2>
          </div>
          <NavItem href="/profile" icon={<Store size={18} />} active={location === "/profile"}>
            Restaurant Profile
          </NavItem>
          <NavItem href="/ai-settings" icon={<Bot size={18} />} active={location === "/ai-settings"}>
            AI Assistant
          </NavItem>
          <NavItem href="/preferences" icon={<Settings size={18} />} active={location === "/preferences"}>
            Preferences
          </NavItem>
          <NavItem href="/integrations" icon={<Puzzle size={18} />} active={location === "/integrations"}>
            Integrations
          </NavItem>
        </nav>

        <div className="border-t border-gray-200 p-4">
          <div className="flex items-center">
            {/* This will use actual user data from the authentication context */}
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-500">
              <Users size={18} />
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-700">Restaurant Admin</p>
              <p className="text-xs text-gray-500">Restaurant Name</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-20 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between p-4">
          <h1 className="text-xl font-semibold text-gray-800">ToBeOut</h1>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setIsMobileMenuOpen(true)}
            className="text-gray-500 hover:text-gray-600"
          >
            <Menu size={24} />
          </Button>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-black bg-opacity-50">
          <div className="absolute right-0 top-0 bottom-0 w-64 bg-white">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-semibold">Menu</h2>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsMobileMenuOpen(false)}
                className="text-gray-500"
              >
                <span className="sr-only">Close</span>
                <span aria-hidden="true">&times;</span>
              </Button>
            </div>
            <nav className="p-4">
              <Link href="/dashboard">
                <a 
                  className={cn(
                    "block py-2 px-4 rounded mb-1",
                    location === "/dashboard" 
                      ? "text-blue-500 bg-blue-50" 
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Dashboard
                </a>
              </Link>
              <Link href="/reservations">
                <a 
                  className={cn(
                    "block py-2 px-4 rounded mb-1",
                    location === "/reservations" 
                      ? "text-blue-500 bg-blue-50" 
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Reservations
                </a>
              </Link>
              <Link href="/tables">
                <a 
                  className={cn(
                    "block py-2 px-4 rounded mb-1",
                    location === "/tables" 
                      ? "text-blue-500 bg-blue-50" 
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Tables
                </a>
              </Link>
              <Link href="/guests">
                <a 
                  className={cn(
                    "block py-2 px-4 rounded mb-1",
                    location === "/guests" 
                      ? "text-blue-500 bg-blue-50" 
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Guests
                </a>
              </Link>
              <Link href="/profile">
                <a 
                  className={cn(
                    "block py-2 px-4 rounded mb-1",
                    location === "/profile" 
                      ? "text-blue-500 bg-blue-50" 
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Restaurant Profile
                </a>
              </Link>
              <Link href="/ai-settings">
                <a 
                  className={cn(
                    "block py-2 px-4 rounded mb-1",
                    location === "/ai-settings" 
                      ? "text-blue-500 bg-blue-50" 
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  AI Assistant
                </a>
              </Link>
              <Link href="/preferences">
                <a 
                  className={cn(
                    "block py-2 px-4 rounded mb-1",
                    location === "/preferences" 
                      ? "text-blue-500 bg-blue-50" 
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Preferences
                </a>
              </Link>
              <Link href="/integrations">
                <a 
                  className={cn(
                    "block py-2 px-4 rounded mb-1",
                    location === "/integrations" 
                      ? "text-blue-500 bg-blue-50" 
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Integrations
                </a>
              </Link>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
