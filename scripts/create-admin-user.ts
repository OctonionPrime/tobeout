import { db } from "../server/db";
import { users, restaurants } from "../shared/schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

async function createAdminUser() {
  try {
    console.log("Checking if admin user exists...");
    
    // Check if admin user already exists
    const existingUsers = await db.select().from(users).where(eq(users.email, "admin@tobeout.com"));
    const existingUser = existingUsers[0];
    
    if (existingUser) {
      console.log("Admin user already exists with email: admin@tobeout.com");
      process.exit(0);
    }
    
    // Create admin user
    console.log("Creating admin user...");
    const hashedPassword = await bcrypt.hash("admin123", 10);
    
    const [adminUser] = await db.insert(users).values({
      email: "admin@tobeout.com",
      password: hashedPassword,
      name: "Admin User",
      role: "admin",
    }).returning();
    
    console.log("Admin user created with ID:", adminUser.id);
    
    // Create a demo restaurant for the admin
    console.log("Creating demo restaurant...");
    const [restaurant] = await db.insert(restaurants).values({
      userId: adminUser.id,
      name: "Demo Restaurant",
      description: "A sample restaurant for demonstration purposes",
      country: "USA",
      city: "New York",
      address: "123 Main Street",
      openingTime: "10:00:00",
      closingTime: "22:00:00",
      cuisine: "International",
      atmosphere: "Casual",
      features: ["Wi-Fi", "Outdoor Seating", "Bar"],
      tags: ["Family-Friendly", "Brunch", "Dinner"],
      languages: ["English", "Spanish"],
      phone: "+1 (555) 123-4567",
    }).returning();
    
    console.log("Demo restaurant created with ID:", restaurant.id);
    console.log("\nAdmin user created successfully!");
    console.log("Email: admin@tobeout.com");
    console.log("Password: admin123");
    
    process.exit(0);
  } catch (error) {
    console.error("Error creating admin user:", error);
    process.exit(1);
  }
}

createAdminUser();