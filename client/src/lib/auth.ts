import { apiRequest } from "./queryClient";

// Login user
export async function login(email: string, password: string) {
  const response = await apiRequest("POST", "/api/auth/login", {
    email,
    password,
  });
  return response.json();
}

// Register user
export async function register(userData: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  restaurantName: string;
  phone?: string;
}) {
  const response = await apiRequest("POST", "/api/auth/register", userData);
  return response.json();
}

// Logout user
export async function logout() {
  const response = await apiRequest("POST", "/api/auth/logout", {});
  return response.json();
}

// Get current user
export async function getCurrentUser() {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      return null;
    }
    throw new Error("Failed to fetch current user");
  }
  
  return response.json();
}
