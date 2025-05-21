import { db } from "../server/db";
import { users } from "../shared/schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

async function updateAdminPassword() {
  try {
    console.log("Looking for admin user...");
    
    // Find the admin user
    const existingUsers = await db.select().from(users).where(eq(users.email, "admin@tobeout.com"));
    const existingUser = existingUsers[0];
    
    if (!existingUser) {
      console.log("Admin user not found with email: admin@tobeout.com");
      process.exit(1);
    }
    
    // Update admin password
    console.log("Updating admin password...");
    const hashedPassword = await bcrypt.hash("admin123", 10);
    
    await db.update(users)
      .set({
        password: hashedPassword
      })
      .where(eq(users.id, existingUser.id));
    
    console.log("\nAdmin password updated successfully!");
    console.log("Email: admin@tobeout.com");
    console.log("New Password: admin123");
    
    process.exit(0);
  } catch (error) {
    console.error("Error updating admin password:", error);
    process.exit(1);
  }
}

updateAdminPassword();