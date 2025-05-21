import OpenAI from "openai";
import { storage } from "../storage";

// The newest OpenAI model is "gpt-4o" which was released May 13, 2024. Do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "sk-dummy-key-for-development" });

// Message types for OpenAI API
type SystemMessage = { role: "system"; content: string };
type UserMessage = { role: "user"; content: string };
type AssistantMessage = { role: "assistant"; content: string };
type Message = SystemMessage | UserMessage | AssistantMessage;

// Types for reservation intents
interface ReservationIntent {
  date?: string;
  time?: string;
  guests?: number;
  name?: string;
  phone?: string;
  special_requests?: string;
  confidence: number;
}

export async function detectReservationIntent(message: string): Promise<ReservationIntent> {
  try {
    const systemPrompt = `
      You are an AI assistant for a restaurant reservation system. 
      Analyze the user message and extract the following information for a restaurant reservation:
      - date (in YYYY-MM-DD format)
      - time (in HH:MM format, 24-hour)
      - number of guests (integer)
      - name (string)
      - phone (string)
      - special_requests (string)
      - confidence (number between 0 and 1 indicating how confident you are this is a reservation request)
      
      Only extract what's explicitly mentioned. Leave fields empty if not mentioned.
      Provide the data in JSON format.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content) as ReservationIntent;
  } catch (error) {
    console.error("Error detecting reservation intent:", error);
    return { confidence: 0 };
  }
}

interface AvailableSlot {
  date: string;
  time: string;
  tableId: number;
  timeslotId: number;
}

export async function suggestAlternativeSlots(
  restaurantId: number,
  date: string,
  time: string,
  guests: number,
  preferredTableFeatures: string[] = []
): Promise<AvailableSlot[]> {
  try {
    // Get restaurant tables that can accommodate the guests
    const allTables = await storage.getTables(restaurantId);
    const suitableTables = allTables.filter(
      table => table.minGuests <= guests && table.maxGuests >= guests
    );
    
    if (suitableTables.length === 0) {
      return [];
    }
    
    // Get timeslots for the requested date
    const timeslots = await storage.getTimeslots(restaurantId, date);
    
    // Filter free timeslots
    const freeTimeslots = timeslots.filter(
      ts => ts.status === 'free' && 
      suitableTables.some(table => table.id === ts.tableId)
    );
    
    if (freeTimeslots.length === 0) {
      return [];
    }
    
    // Sort timeslots by closeness to requested time
    const requestedTime = new Date(`${date}T${time}`);
    
    const sortedTimeslots = freeTimeslots.sort((a, b) => {
      const aTime = new Date(`${date}T${a.time}`);
      const bTime = new Date(`${date}T${b.time}`);
      
      return Math.abs(aTime.getTime() - requestedTime.getTime()) - 
             Math.abs(bTime.getTime() - requestedTime.getTime());
    });
    
    // Return the top 3 closest times
    return sortedTimeslots.slice(0, 3).map(ts => ({
      date,
      time: ts.time,
      tableId: ts.tableId,
      timeslotId: ts.id
    }));
  } catch (error) {
    console.error("Error suggesting alternative slots:", error);
    return [];
  }
}

export async function generateReservationConfirmation(
  guestName: string,
  date: string,
  time: string,
  guests: number,
  restaurantName: string,
  tableFeatures?: string[]
): Promise<string> {
  try {
    const featuresText = tableFeatures && tableFeatures.length > 0 
      ? `Your table has the following features: ${tableFeatures.join(', ')}.` 
      : '';
      
    const systemPrompt = `
      You are a friendly AI assistant for the restaurant "${restaurantName}".
      Generate a brief, polite confirmation message for a reservation.
      Keep it concise but warm and professional.
    `;

    const userPrompt = `
      Create a reservation confirmation message for ${guestName} who has reserved a table for ${guests} people on ${date} at ${time}.
      ${featuresText}
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 150
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error generating reservation confirmation:", error);
    return `Your reservation for ${guests} people on ${date} at ${time} is confirmed. Thank you for choosing ${restaurantName}!`;
  }
}
