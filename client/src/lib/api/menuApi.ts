import { queryClient } from "@/lib/queryClient";

// A helper to handle API requests and standardize error handling.
async function apiFetch(url: string, options: RequestInit = {}) {
    const defaultOptions: RequestInit = {
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        credentials: "include", // Ensures cookies are sent with requests
    };

    const res = await fetch(url, { ...defaultOptions, ...options });

    if (!res.ok) {
        // Try to parse a JSON error message from the backend, otherwise use status text.
        const errorBody = await res.json().catch(() => ({ message: res.statusText }));
        console.error("API Error:", errorBody);
        throw new Error(errorBody.message || "An unknown API error occurred");
    }

    // Handle responses that might not have a body (e.g., DELETE requests)
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
        return res.json();
    }
    // For non-JSON responses (like a 204 No Content), return a success indicator.
    return { success: true };
}

// ============================================================================
// TYPES
// ============================================================================

export interface MenuItem {
    id: number;
    name: string;
    description?: string;
    price: string;
    categoryName: string;
    isAvailable: boolean;
    isPopular: boolean;
    [key: string]: any;
}

export interface MenuFilters {
    category?: string;
    available?: boolean;
    search?: string;
    popular?: boolean;
}

export interface MenuItemPayload {
    name: string;
    description?: string;
    price: string;
    category: string;
    isAvailable: boolean;
    isPopular: boolean;
}

export interface MenuCategory {
    id: number;
    name: string;
    description?: string;
}

// ============================================================================
// CATEGORY API FUNCTIONS
// ============================================================================

export const getMenuCategories = async (): Promise<MenuCategory[]> => {
    return apiFetch("/api/menu-categories");
};

export const createMenuCategory = async (data: { name: string; description?: string }) => {
    return apiFetch("/api/menu-categories", {
        method: "POST",
        body: JSON.stringify(data),
    });
};

export const updateMenuCategory = async (id: number, data: Partial<MenuCategory>) => {
    return apiFetch(`/api/menu-categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
    });
};

export const deleteMenuCategory = async (id: number) => {
    return apiFetch(`/api/menu-categories/${id}`, {
        method: "DELETE",
    });
};

// ============================================================================
// MENU ITEM API FUNCTIONS
// ============================================================================

export const getMenuItems = async (filters: MenuFilters = {}): Promise<{ items: MenuItem[], categories: string[], stats: any }> => {
    const params = new URLSearchParams();
    if (filters.category) params.append('category', filters.category);
    if (filters.available !== undefined) params.append('available', String(filters.available));
    if (filters.search) params.append('search', filters.search);
    if (filters.popular) params.append('popular', String(filters.popular));

    const query = params.toString();
    return apiFetch(`/api/menu-items?${query}`);
};

export const createMenuItem = async (itemData: MenuItemPayload) => {
    return apiFetch("/api/menu-items", {
        method: "POST",
        body: JSON.stringify(itemData),
    });
};

export const updateMenuItem = async (id: number, itemData: Partial<MenuItemPayload>) => {
    return apiFetch(`/api/menu-items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(itemData),
    });
};

export const deleteMenuItem = async (id: number) => {
    return apiFetch(`/api/menu-items/${id}`, {
        method: "DELETE",
    });
};

// ============================================================================
// QUERY INVALIDATION
// ============================================================================

/**
 * Invalidates all queries related to the menu, forcing a refetch of both
 * items and categories to ensure the UI is always up-to-date.
 */
export const invalidateMenuQueries = () => {
    // Invalidate both items and categories for a complete refresh
    queryClient.invalidateQueries({ queryKey: ['menuItems'] });
    queryClient.invalidateQueries({ queryKey: ['menuCategories'] });
};
