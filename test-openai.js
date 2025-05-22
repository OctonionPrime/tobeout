import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function testOpenAI() {
  try {
    console.log("Testing OpenAI API connection...");
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "user", content: "Hello, this is a test message. Please respond briefly." }
      ],
      max_tokens: 50,
    });

    console.log("✓ OpenAI API working!");
    console.log("Response:", response.choices[0].message.content);
    
    return true;
  } catch (error) {
    console.error("✗ OpenAI API failed:", error.message);
    return false;
  }
}

testOpenAI();