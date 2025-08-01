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
  Menu as MenuIcon // Aliased to avoid conflict with mobile menu button
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WebSocketStatusCompact } from '@/components/websocket/WebSocketStatus';

interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  active?: boolean;
}

const NavItem = ({ href, icon, children, active }: NavItemProps) => (
  <Link href={href}>
    <div 
      className={cn(
        "flex items-center px-6 py-3 text-gray-700 hover:bg-gray-50 cursor-pointer transition-colors duration-150",
        active && "bg-blue-50 border-r-4 border-blue-500 font-semibold"
      )}
    >
      <div className={cn("w-5", active ? "text-blue-500" : "text-gray-400")}>
        {icon}
      </div>
      <span className={cn("mx-3", active ? "text-blue-600" : "text-gray-700")}>{children}</span>
    </div>
  </Link>
);

export function Sidebar() {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: "/dashboard", icon: <LayoutDashboard size={18} />, text: "Dashboard" },
    { href: "/reservations", icon: <CalendarDays size={18} />, text: "Reservations" },
    { href: "/tables", icon: <Utensils size={18} />, text: "Tables" },
    { href: "/menu", icon: <MenuIcon size={18} />, text: "Menu" },
    { href: "/guests", icon: <Users size={18} />, text: "Guests" },
    { href: "/analytics", icon: <BarChart3 size={18} />, text: "Analytics" },
  ];

  const settingsLinks = [
    { href: "/profile", icon: <Store size={18} />, text: "Restaurant Profile" },
    { href: "/ai-settings", icon: <Bot size={18} />, text: "AI Assistant" },
    { href: "/preferences", icon: <Settings size={18} />, text: "Preferences" },
    { href: "/integrations", icon: <Puzzle size={18} />, text: "Integrations" },
  ];

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-800">ToBeOut</h1>
              <p className="text-sm text-gray-500">Restaurant Management</p>
            </div>
            <WebSocketStatusCompact />
          </div>
        </div>

        <nav className="flex-1 pt-4 pb-4 overflow-y-auto">
          <div className="px-4 mb-2">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Main</h2>
          </div>
          {navLinks.map(link => (
            <NavItem key={link.href} href={link.href} icon={link.icon} active={location === link.href}>
              {link.text}
            </NavItem>
          ))}

          <div className="px-4 mt-6 mb-2">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Settings</h2>
          </div>
          {settingsLinks.map(link => (
            <NavItem key={link.href} href={link.href} icon={link.icon} active={location === link.href}>
              {link.text}
            </NavItem>
          ))}
        </nav>

        <div className="border-t border-gray-200 p-4">
          <div className="flex items-center">
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
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-800">ToBeOut</h1>
            <WebSocketStatusCompact />
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setIsMobileMenuOpen(true)}
            className="text-gray-500 hover:text-gray-600"
          >
            <MenuIcon size={24} />
          </Button>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-black bg-opacity-50" onClick={() => setIsMobileMenuOpen(false)}>
          <div className="absolute right-0 top-0 bottom-0 w-64 bg-white" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Menu</h2>
                <WebSocketStatusCompact />
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsMobileMenuOpen(false)}
                className="text-gray-500"
              >
                <span className="sr-only">Close</span>
                <span aria-hidden="true" className="text-2xl">&times;</span>
              </Button>
            </div>
            <nav className="p-4">
              {[...navLinks, ...settingsLinks].map(link => (
                 <Link key={link.href} href={link.href}>
                    <a 
                      className={cn(
                        "block py-2 px-4 rounded mb-1",
                        location === link.href 
                          ? "text-blue-500 bg-blue-50" 
                          : "text-gray-700 hover:bg-gray-50"
                      )}
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      {link.text}
                    </a>
                  </Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
