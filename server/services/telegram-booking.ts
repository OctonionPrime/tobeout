import { storage } from '../storage';
import { createReservation } from './booking';

export async function createTelegramReservation(
  restaurantId: number,
  date: string,
  time: string,
  guests: number,
  name: string,
  phone: string,
  comments?: string
) {
  try {
    console.log(`🤖 Telegram booking request: ${guests} guests on ${date} at ${time}`);
    
    // Find or create guest
    let guest = await storage.getGuestByPhone(phone);
    if (!guest) {
      guest = await storage.createGuest({
        name,
        phone,
        email: '',
        language: 'en'
      });
      console.log(`✨ Created new guest: ${name}`);
    }
    
    // Use smart table assignment - this will find Table 5 for 6 people!
    const result = await createReservation({
      restaurantId,
      guestId: guest.id,
      date,
      time,
      guests,
      comments: comments || '',
      source: 'telegram'
    });
    
    console.log(`📋 Booking result:`, result);
    return result;
    
  } catch (error) {
    console.error('❌ Telegram booking error:', error);
    return {
      success: false,
      message: `Failed to create reservation: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}