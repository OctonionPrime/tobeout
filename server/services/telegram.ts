import TelegramBot from 'node-telegram-bot-api';
import { storage } from '../storage';
import { enhancedConversationManager, type Language } from './enhanced-conversation-manager';
import { tenantContextManager } from './tenant-context';
import {
    createTelegramReservation,
    type CreateTelegramReservationResult
} from './telegram_booking';
import type { Restaurant } from '@shared/schema';
import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { restaurants as schemaRestaurants, integrationSettings as schemaIntegrationSettings } from '@shared/schema';

// 🚨 RACE CONDITION FIX: Message queuing infrastructure
interface QueuedMessage {
    text: string;
    msg: TelegramBot.Message;
    timestamp: number;
}

const messageQueues = new Map<number, QueuedMessage[]>();
const processingLocks = new Set<number>();
const activePromises = new Map<number, Promise<void>>();

const activeBots = new Map<number, TelegramBot>();
// Store active Telegram sessions
const telegramSessions = new Map<number, string>(); // chatId -> sessionId

interface TelegramLocalizedStrings {
    welcomeMessage: (restaurantName: string) => string;
    helpMessage: string;
    cancelMessage: string;
    genericError: string;
    slotUnavailableAnymore: string;
    errorCreatingReservation: string;
    errorCheckingAvailability: string;
    errorHandlingAlternative: string;
    invalidAlternativeSelection: string;
    botNotConfigured: string;
    telegramTestSuccess: (botUsername: string) => string;
    telegramTestFailed: (errorMessage: string) => string;
    nameClarificationPrompt: (dbName: string, requestName: string) => string;
    useNewNameButton: (requestName: string) => string;
    useDbNameButton: (dbName: string) => string;
    pleaseUseButtons: string;
    nameConfirmationUsed: (name: string) => string;
}

// ✅ ENHANCED: Expanded localization for all supported languages
const telegramLocaleStrings: Record<Language, TelegramLocalizedStrings> = {
    en: {
        welcomeMessage: (restaurantName) => `🌟 Hello! Welcome to ${restaurantName}! I'm Sofia, and I'm absolutely delighted to help you secure the perfect table! ✨\n\nI can assist you with making a reservation right now. Just let me know:\n• When you'd like to dine 📅\n• How many guests will be joining you 👥\n• Your preferred time ⏰\n\nI'll take care of everything else! 🥂\n\nWhat sounds good to you?`,
        helpMessage: `🆘 **How I can help you:**\n\nI'm Sofia, your restaurant assistant! I can help you:\n\n✅ Make reservations\n✅ Check table availability\n✅ Find alternative times\n✅ Answer questions about dining\n\n**Just tell me:**\n• What date you'd like to visit\n• Your preferred time\n• How many people\n• Your name\n\nI'll handle the rest!\n\n**Commands:**\n/start - Start fresh conversation\n/help - Show this help\n/cancel - Cancel current booking process\n\nReady to make a reservation? Just tell me what you need! 😊`,
        cancelMessage: "No worries! I've cleared our conversation. Feel free to start fresh whenever you're ready to make a reservation! 😊",
        genericError: "I apologize for the technical hiccup! I'm Sofia. How can I help you with a reservation today? 😊",
        slotUnavailableAnymore: "I'm sorry, but that time slot just became unavailable. Let me check for other options... 🔄",
        errorCreatingReservation: "I encountered a small issue while confirming your reservation. Let me try again in just a moment!",
        errorCheckingAvailability: "Sorry, I couldn't check availability right now. Please try again in a moment.",
        errorHandlingAlternative: "Let me help you find another option. What time would you prefer?",
        invalidAlternativeSelection: "That's not a valid option number. Please choose one of the numbers I listed, or let me know if you'd like to try a different date or time.",
        botNotConfigured: "Telegram bot is not configured or enabled for this restaurant.",
        telegramTestSuccess: (botUsername) => `Successfully connected to Telegram bot: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Failed to connect to Telegram bot: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `I see you've previously booked as '${dbName}'. For this new reservation, would you like to use the name '${requestName}' or keep '${dbName}'?`,
        useNewNameButton: (requestName) => `Use "${requestName}"`,
        useDbNameButton: (dbName) => `Keep "${dbName}"`,
        pleaseUseButtons: "Please use the buttons above to make your choice.",
        nameConfirmationUsed: (name) => `Perfect! Using the name: ${name}`,
    },
    ru: {
        welcomeMessage: (restaurantName) => `🌟 Здравствуйте! Добро пожаловать в ${restaurantName}! Я София, и я очень рада помочь вам забронировать идеальный столик! ✨\n\nЯ могу помочь вам сделать бронирование прямо сейчас. Просто сообщите мне:\n• Когда вы хотели бы поужинать 📅\n• Сколько гостей будет с вами 👥\n• Предпочтительное время ⏰\n\nЯ позабочусь обо всем остальном! 🥂\n\nЧто вам подходит?`,
        helpMessage: `🆘 **Чем я могу помочь:**\n\nЯ София, ваш помощник по ресторану! Я могу помочь вам:\n\n✅ Сделать бронирование\n✅ Проверить наличие столиков\n✅ Найти альтернативное время\n✅ Ответить на вопросы о ресторане\n\n**Просто скажите мне:**\n• На какую дату вы хотели бы прийти\n• Предпочтительное время\n• Количество человек\n• Ваше имя\n\nЯ сделаю все остальное!\n\n**Команды:**\n/start - Начать новый разговор\n/help - Показать эту справку\n/cancel - Отменить текущий процесс бронирования\n\nГотовы сделать бронирование? Просто скажите, что вам нужно! 😊`,
        cancelMessage: "Без проблем! Я очистила наш разговор. Не стесняйтесь начать заново, когда будете готовы сделать бронирование! 😊",
        genericError: "Приношу извинения за техническую неполадку! Я София. Чем могу помочь вам с бронированием сегодня? 😊",
        slotUnavailableAnymore: "К сожалению, этот временной слот только что стал недоступен. Позвольте мне проверить другие варианты... 🔄",
        errorCreatingReservation: "Я столкнулась с небольшой проблемой при подтверждении вашего бронирования. Позвольте мне попробовать еще раз через мгновение!",
        errorCheckingAvailability: "Извините, я не смогла проверить наличие мест прямо сейчас. Пожалуйста, попробуйте еще раз через мгновение.",
        errorHandlingAlternative: "Позвольте мне помочь вам найти другой вариант. Какое время вы бы предпочли?",
        invalidAlternativeSelection: "Это неверный номер варианта. Пожалуйста, выберите один из перечисленных номеров или сообщите, если хотите попробовать другую дату или время.",
        botNotConfigured: "Телеграм-бот не настроен или не включен для этого ресторана.",
        telegramTestSuccess: (botUsername) => `Успешное подключение к Телеграм-боту: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Не удалось подключиться к Телеграм-боту: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `Я вижу, что ранее вы бронировали под именем '${dbName}'. Для этого нового бронирования использовать имя '${requestName}' или оставить '${dbName}'?`,
        useNewNameButton: (requestName) => `Использовать "${requestName}"`,
        useDbNameButton: (dbName) => `Оставить "${dbName}"`,
        pleaseUseButtons: "Пожалуйста, выберите один из вариантов с помощью кнопок выше.",
        nameConfirmationUsed: (name) => `Отлично! Используем имя: ${name}`,
    },
    sr: {
        welcomeMessage: (restaurantName) => `🌟 Zdravo! Dobrodošli u ${restaurantName}! Ja sam Sofija, i izuzetno sam zadovoljna što mogu da vam pomognem da obezbedite savršen sto! ✨\n\nMogu da vam pomognem da napravite rezervaciju odmah sada. Samo mi recite:\n• Kada biste voleli da dođete 📅\n• Koliko gostiju će vam se pridružiti 👥\n• Vaše željeno vreme ⏰\n\nJa ću se pobrinuti za sve ostalo! 🥂\n\nŠta vam odgovara?`,
        helpMessage: `🆘 **Kako mogu da pomognem:**\n\nJa sam Sofija, vaš asistent za restoran! Mogu da pomognem sa:\n\n✅ Pravljenjem rezervacija\n✅ Proverom dostupnosti stolova\n✅ Pronalaženjem alternativnih termina\n✅ Odgovaranjem na pitanja o restoranu\n\n**Samo mi recite:**\n• Koji datum želite za posetu\n• Vaše željeno vreme\n• Koliko osoba\n• Vaše ime\n\nJa ću obaviti ostatak!\n\n**Komande:**\n/start - Počni nov razgovor\n/help - Prikaži ovu pomoć\n/cancel - Otkaži trenutni proces rezervacije\n\nSpremni za rezervaciju? Samo recite šta vam treba! 😊`,
        cancelMessage: "Ne brinite! Obrisala sam naš razgovor. Slobodno počnite iznova kad god budete spremni za rezervaciju! 😊",
        genericError: "Izvinjavam se zbog tehničke greške! Ja sam Sofija. Kako mogu da pomognem sa rezervacijom danas? 😊",
        slotUnavailableAnymore: "Žao mi je, ali taj termin je upravo postao nedostupan. Dozvolite mi da proverim druge opcije... 🔄",
        errorCreatingReservation: "Naišla sam na mali problem prilikom potvrđivanja vaše rezervacije. Dozvolite mi da pokušam ponovo za trenutak!",
        errorCheckingAvailability: "Izvini, trenutno ne mogu da proverim dostupnost. Molim pokušajte ponovo za trenutak.",
        errorHandlingAlternative: "Dozvolite mi da vam pomognem da pronađem drugu opciju. Koje vreme biste preferirali?",
        invalidAlternativeSelection: "To nije važeći broj opcije. Molim odaberite jedan od brojeva koje sam navela, ili mi recite ako želite da probamo drugi datum ili vreme.",
        botNotConfigured: "Telegram bot nije konfigurisan ili omogućen za ovaj restoran.",
        telegramTestSuccess: (botUsername) => `Uspešno povezano sa Telegram botom: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Neuspešno povezivanje sa Telegram botom: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `Vidim da ste ranije rezervisali pod imenom '${dbName}'. Za ovu novu rezervaciju, želite li da koristite ime '${requestName}' ili da zadržite '${dbName}'?`,
        useNewNameButton: (requestName) => `Koristi "${requestName}"`,
        useDbNameButton: (dbName) => `Zadrži "${dbName}"`,
        pleaseUseButtons: "Molim koristite dugmad iznad da napravite izbor.",
        nameConfirmationUsed: (name) => `Savršeno! Koristimo ime: ${name}`,
    },
    // ✅ NEW: Additional language support
    hu: {
        welcomeMessage: (restaurantName) => `🌟 Szia! Üdvözlöm a ${restaurantName}-ban! Én Szófia vagyok, és nagyon örülök, hogy segíthetek a tökéletes asztal lefoglalásában! ✨\n\nSegíthetek most rögtön asztalfoglalást intézni. Csak mondd meg:\n• Mikor szeretnél vacsorázni 📅\n• Hány vendég lesz veled 👥\n• Milyen időpontot szeretnél ⏰\n\nA többiről én gondoskodom! 🥂\n\nMi lenne jó neked?`,
        helpMessage: `🆘 **Hogyan segíthetek:**\n\nÉn Szófia vagyok, a te éttermi asszisztensed! Segíthetek:\n\n✅ Asztalfoglalás\n✅ Asztal elérhetőség ellenőrzése\n✅ Alternatív időpontok keresése\n✅ Étteremmel kapcsolatos kérdések megválaszolása\n\n**Csak mondd meg:**\n• Melyik napra szeretnél jönni\n• Milyen időpontot szeretnél\n• Hány főre\n• A neved\n\nA többit intézem!\n\n**Parancsok:**\n/start - Új beszélgetés kezdése\n/help - Segítség megjelenítése\n/cancel - Jelenlegi foglalási folyamat megszakítása\n\nKész vagy foglalni? Csak mondd meg, mire van szükséged! 😊`,
        cancelMessage: "Semmi baj! Töröltem a beszélgetésünket. Nyugodtan kezdj újat, amikor kész vagy foglalni! 😊",
        genericError: "Elnézést a technikai hibáért! Én Szófia vagyok. Hogyan segíthetek ma foglalásban? 😊",
        slotUnavailableAnymore: "Sajnálom, de ez az időpont éppen elérhetetlenné vált. Hadd nézzek más lehetőségeket... 🔄",
        errorCreatingReservation: "Kis problémába ütköztem a foglalás megerősítése közben. Hadd próbáljam újra egy pillanat múlva!",
        errorCheckingAvailability: "Sajnálom, most nem tudtam ellenőrizni az elérhetőséget. Kérlek próbáld újra egy pillanat múlva.",
        errorHandlingAlternative: "Hadd segítsek más lehetőséget találni. Milyen időpontot preferálnál?",
        invalidAlternativeSelection: "Ez nem érvényes opció szám. Kérlek válassz a felsorolt számok közül, vagy mondd meg ha másik dátumot vagy időt szeretnél.",
        botNotConfigured: "A Telegram bot nincs beállítva vagy engedélyezve ehhez az étteremhez.",
        telegramTestSuccess: (botUsername) => `Sikeresen csatlakoztam a Telegram bothoz: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Nem sikerült csatlakozni a Telegram bothoz: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `Látom, hogy korábban '${dbName}' néven foglaltál. Ehhez az új foglaláshoz a '${requestName}' nevet használjam vagy megtartsam a '${dbName}'-t?`,
        useNewNameButton: (requestName) => `"${requestName}" használata`,
        useDbNameButton: (dbName) => `"${dbName}" megtartása`,
        pleaseUseButtons: "Kérlek használd a fenti gombokat a választáshoz.",
        nameConfirmationUsed: (name) => `Tökéletes! A következő nevet használom: ${name}`,
    },
    // ✅ Add minimal versions for other languages (these can be expanded later)
    de: {
        welcomeMessage: (restaurantName) => `🌟 Hallo! Willkommen im ${restaurantName}! Ich bin Sofia und helfe Ihnen gerne bei der Tischreservierung! ✨`,
        helpMessage: `🆘 **Wie ich helfen kann:** Ich bin Sofia, Ihre Restaurant-Assistentin!`,
        cancelMessage: "Kein Problem! Gespräch gelöscht. Starten Sie neu, wenn Sie bereit sind!",
        genericError: "Entschuldigung für das technische Problem! Ich bin Sofia. Wie kann ich bei einer Reservierung helfen?",
        slotUnavailableAnymore: "Entschuldigung, dieser Zeitslot ist nicht mehr verfügbar.",
        errorCreatingReservation: "Kleines Problem bei der Reservierungsbestätigung.",
        errorCheckingAvailability: "Verfügbarkeit kann momentan nicht geprüft werden.",
        errorHandlingAlternative: "Lassen Sie mich eine andere Option finden.",
        invalidAlternativeSelection: "Das ist keine gültige Option.",
        botNotConfigured: "Telegram-Bot ist für dieses Restaurant nicht konfiguriert.",
        telegramTestSuccess: (botUsername) => `Erfolgreich mit Telegram-Bot verbunden: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Verbindung mit Telegram-Bot fehlgeschlagen: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `Sie haben früher als '${dbName}' gebucht. Möchten Sie '${requestName}' oder '${dbName}' verwenden?`,
        useNewNameButton: (requestName) => `"${requestName}" verwenden`,
        useDbNameButton: (dbName) => `"${dbName}" behalten`,
        pleaseUseButtons: "Bitte verwenden Sie die Tasten oben.",
        nameConfirmationUsed: (name) => `Perfekt! Verwende den Namen: ${name}`,
    },
    fr: {
        welcomeMessage: (restaurantName) => `🌟 Bonjour! Bienvenue chez ${restaurantName}! Je suis Sofia et je suis ravie de vous aider avec votre réservation! ✨`,
        helpMessage: `🆘 **Comment je peux vous aider:** Je suis Sofia, votre assistante restaurant!`,
        cancelMessage: "Pas de problème! Conversation effacée. Recommencez quand vous voulez!",
        genericError: "Désolée pour le problème technique! Je suis Sofia. Comment puis-je vous aider avec une réservation?",
        slotUnavailableAnymore: "Désolée, ce créneau n'est plus disponible.",
        errorCreatingReservation: "Petit problème lors de la confirmation de votre réservation.",
        errorCheckingAvailability: "Impossible de vérifier la disponibilité maintenant.",
        errorHandlingAlternative: "Laissez-moi trouver une autre option.",
        invalidAlternativeSelection: "Ce n'est pas une option valide.",
        botNotConfigured: "Le bot Telegram n'est pas configuré pour ce restaurant.",
        telegramTestSuccess: (botUsername) => `Connexion réussie au bot Telegram: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Échec de connexion au bot Telegram: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `Vous avez réservé précédemment sous '${dbName}'. Voulez-vous utiliser '${requestName}' ou garder '${dbName}'?`,
        useNewNameButton: (requestName) => `Utiliser "${requestName}"`,
        useDbNameButton: (dbName) => `Garder "${dbName}"`,
        pleaseUseButtons: "Veuillez utiliser les boutons ci-dessus.",
        nameConfirmationUsed: (name) => `Parfait! J'utilise le nom: ${name}`,
    },
    es: {
        welcomeMessage: (restaurantName) => `🌟 ¡Hola! ¡Bienvenido/a a ${restaurantName}! Soy Sofia y estoy encantada de ayudarte con tu reserva! ✨`,
        helpMessage: `🆘 **Cómo puedo ayudarte:** ¡Soy Sofia, tu asistente del restaurante!`,
        cancelMessage: "¡No hay problema! Conversación borrada. ¡Empieza de nuevo cuando quieras!",
        genericError: "¡Disculpa por el problema técnico! Soy Sofia. ¿Cómo puedo ayudarte con una reserva?",
        slotUnavailableAnymore: "Lo siento, ese horario ya no está disponible.",
        errorCreatingReservation: "Pequeño problema al confirmar tu reserva.",
        errorCheckingAvailability: "No puedo verificar disponibilidad ahora.",
        errorHandlingAlternative: "Déjame encontrar otra opción.",
        invalidAlternativeSelection: "Esa no es una opción válida.",
        botNotConfigured: "El bot de Telegram no está configurado para este restaurante.",
        telegramTestSuccess: (botUsername) => `Conexión exitosa con bot de Telegram: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Fallo al conectar con bot de Telegram: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `Veo que reservaste anteriormente como '${dbName}'. ¿Quieres usar '${requestName}' o mantener '${dbName}'?`,
        useNewNameButton: (requestName) => `Usar "${requestName}"`,
        useDbNameButton: (dbName) => `Mantener "${dbName}"`,
        pleaseUseButtons: "Por favor usa los botones de arriba.",
        nameConfirmationUsed: (name) => `¡Perfecto! Usando el nombre: ${name}`,
    },
    it: {
        welcomeMessage: (restaurantName) => `🌟 Ciao! Benvenuto/a al ${restaurantName}! Sono Sofia e sono felice di aiutarti con la tua prenotazione! ✨`,
        helpMessage: `🆘 **Come posso aiutarti:** Sono Sofia, la tua assistente del ristorante!`,
        cancelMessage: "Nessun problema! Conversazione cancellata. Ricomincia quando vuoi!",
        genericError: "Scusa per il problema tecnico! Sono Sofia. Come posso aiutarti con una prenotazione?",
        slotUnavailableAnymore: "Mi dispiace, quell'orario non è più disponibile.",
        errorCreatingReservation: "Piccolo problema nel confermare la tua prenotazione.",
        errorCheckingAvailability: "Non riesco a verificare la disponibilità ora.",
        errorHandlingAlternative: "Lascia che trovi un'altra opzione.",
        invalidAlternativeSelection: "Quella non è un'opzione valida.",
        botNotConfigured: "Il bot Telegram non è configurato per questo ristorante.",
        telegramTestSuccess: (botUsername) => `Connessione riuscita con bot Telegram: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Connessione fallita con bot Telegram: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `Vedo che hai prenotato prima come '${dbName}'. Vuoi usare '${requestName}' o mantenere '${dbName}'?`,
        useNewNameButton: (requestName) => `Usa "${requestName}"`,
        useDbNameButton: (dbName) => `Mantieni "${dbName}"`,
        pleaseUseButtons: "Per favore usa i pulsanti sopra.",
        nameConfirmationUsed: (name) => `Perfetto! Usando il nome: ${name}`,
    },
    pt: {
        welcomeMessage: (restaurantName) => `🌟 Olá! Bem-vindo/a ao ${restaurantName}! Eu sou Sofia e estou feliz em ajudar com sua reserva! ✨`,
        helpMessage: `🆘 **Como posso ajudar:** Eu sou Sofia, sua assistente do restaurante!`,
        cancelMessage: "Sem problemas! Conversa apagada. Comece novamente quando quiser!",
        genericError: "Desculpe pelo problema técnico! Eu sou Sofia. Como posso ajudar com uma reserva?",
        slotUnavailableAnymore: "Desculpe, esse horário não está mais disponível.",
        errorCreatingReservation: "Pequeno problema ao confirmar sua reserva.",
        errorCheckingAvailability: "Não consigo verificar disponibilidade agora.",
        errorHandlingAlternative: "Deixe-me encontrar outra opção.",
        invalidAlternativeSelection: "Essa não é uma opção válida.",
        botNotConfigured: "O bot do Telegram não está configurado para este restaurante.",
        telegramTestSuccess: (botUsername) => `Conexão bem-sucedida com bot do Telegram: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Falha na conexão com bot do Telegram: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `Vejo que você reservou antes como '${dbName}'. Quer usar '${requestName}' ou manter '${dbName}'?`,
        useNewNameButton: (requestName) => `Usar "${requestName}"`,
        useDbNameButton: (dbName) => `Manter "${dbName}"`,
        pleaseUseButtons: "Por favor use os botões acima.",
        nameConfirmationUsed: (name) => `Perfeito! Usando o nome: ${name}`,
    },
    nl: {
        welcomeMessage: (restaurantName) => `🌟 Hallo! Welkom bij ${restaurantName}! Ik ben Sofia en ik help je graag met je reservering! ✨`,
        helpMessage: `🆘 **Hoe ik kan helpen:** Ik ben Sofia, je restaurant assistent!`,
        cancelMessage: "Geen probleem! Gesprek gewist. Begin opnieuw wanneer je wilt!",
        genericError: "Sorry voor het technische probleem! Ik ben Sofia. Hoe kan ik helpen met een reservering?",
        slotUnavailableAnymore: "Sorry, dat tijdslot is niet meer beschikbaar.",
        errorCreatingReservation: "Klein probleem bij het bevestigen van je reservering.",
        errorCheckingAvailability: "Kan nu geen beschikbaarheid controleren.",
        errorHandlingAlternative: "Laat me een andere optie vinden.",
        invalidAlternativeSelection: "Dat is geen geldige optie.",
        botNotConfigured: "Telegram bot is niet geconfigureerd voor dit restaurant.",
        telegramTestSuccess: (botUsername) => `Succesvol verbonden met Telegram bot: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Verbinding met Telegram bot mislukt: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `Ik zie dat je eerder gereserveerd hebt als '${dbName}'. Wil je '${requestName}' gebruiken of '${dbName}' houden?`,
        useNewNameButton: (requestName) => `"${requestName}" gebruiken`,
        useDbNameButton: (dbName) => `"${dbName}" houden`,
        pleaseUseButtons: "Gebruik de knoppen hierboven.",
        nameConfirmationUsed: (name) => `Perfect! Gebruik de naam: ${name}`,
    },
    auto: {
        // Fallback to English for 'auto'
        welcomeMessage: (restaurantName) => `🌟 Hello! Welcome to ${restaurantName}! I'm Sofia, and I'm absolutely delighted to help you secure the perfect table! ✨`,
        helpMessage: `🆘 **How I can help you:** I'm Sofia, your restaurant assistant!`,
        cancelMessage: "No worries! I've cleared our conversation. Feel free to start fresh whenever you're ready to make a reservation! 😊",
        genericError: "I apologize for the technical hiccup! I'm Sofia. How can I help you with a reservation today? 😊",
        slotUnavailableAnymore: "I'm sorry, but that time slot just became unavailable.",
        errorCreatingReservation: "I encountered a small issue while confirming your reservation.",
        errorCheckingAvailability: "Sorry, I couldn't check availability right now.",
        errorHandlingAlternative: "Let me help you find another option.",
        invalidAlternativeSelection: "That's not a valid option number.",
        botNotConfigured: "Telegram bot is not configured or enabled for this restaurant.",
        telegramTestSuccess: (botUsername) => `Successfully connected to Telegram bot: @${botUsername}`,
        telegramTestFailed: (errorMessage) => `Failed to connect to Telegram bot: ${errorMessage}`,
        nameClarificationPrompt: (dbName, requestName) => `I see you've previously booked as '${dbName}'. Would you like to use '${requestName}' or keep '${dbName}'?`,
        useNewNameButton: (requestName) => `Use "${requestName}"`,
        useDbNameButton: (dbName) => `Keep "${dbName}"`,
        pleaseUseButtons: "Please use the buttons above to make your choice.",
        nameConfirmationUsed: (name) => `Perfect! Using the name: ${name}`,
    }
};

// 🚨 RACE CONDITION FIX: Enhanced typing indicator management
const activeTypingIntervals = new Map<number, NodeJS.Timeout>();

// 🚨 RACE CONDITION FIX: Enqueue message for sequential processing
function enqueueMessage(chatId: number, text: string, msg: TelegramBot.Message): void {
    if (!messageQueues.has(chatId)) {
        messageQueues.set(chatId, []);
    }
    
    messageQueues.get(chatId)!.push({
        text,
        msg,
        timestamp: Date.now()
    });
    
    console.log(`📥 [Sofia AI] Message enqueued for chat ${chatId}: "${text.substring(0, 50)}" (queue size: ${messageQueues.get(chatId)!.length})`);
}

// 🚨 UX ENHANCEMENT: Start persistent typing indicator for queue processing
function startQueueTypingIndicator(chatId: number, bot: TelegramBot): void {
    // Don't start multiple typing indicators for same chat
    if (activeTypingIntervals.has(chatId)) {
        return;
    }
    
    // Show typing immediately
    bot.sendChatAction(chatId, 'typing').catch(error => {
        console.warn(`⚠️ [Sofia AI] Could not send initial typing indicator for chat ${chatId}:`, error);
    });
    
    // Continue showing typing every 4.5 seconds (Telegram typing lasts ~5 seconds)
    const typingInterval = setInterval(() => {
        bot.sendChatAction(chatId, 'typing').catch(error => {
            console.warn(`⚠️ [Sofia AI] Could not send typing indicator for chat ${chatId}:`, error);
        });
    }, 4500);
    
    activeTypingIntervals.set(chatId, typingInterval);
    console.log(`⌨️ [Sofia AI] Started persistent typing indicator for chat ${chatId}`);
}

// 🚨 UX ENHANCEMENT: Stop typing indicator when queue processing is complete
function stopQueueTypingIndicator(chatId: number): void {
    const typingInterval = activeTypingIntervals.get(chatId);
    if (typingInterval) {
        clearInterval(typingInterval);
        activeTypingIntervals.delete(chatId);
        console.log(`⌨️ [Sofia AI] Stopped typing indicator for chat ${chatId}`);
    }
}

// 🚨 RACE CONDITION FIX: Sequential message processing per user with enhanced typing
async function processMessageQueue(
    chatId: number, 
    bot: TelegramBot, 
    restaurantId: number, 
    restaurant: Restaurant
): Promise<void> {
    // Prevent concurrent processing for same user
    if (processingLocks.has(chatId)) {
        console.log(`⏳ [Sofia AI] Chat ${chatId} already processing, will be handled by existing process`);
        return activePromises.get(chatId);
    }
    
    processingLocks.add(chatId);
    
    // 🚨 UX: Start typing indicator immediately when processing begins
    startQueueTypingIndicator(chatId, bot);
    
    const processingPromise = (async () => {
        try {
            const queue = messageQueues.get(chatId);
            let processedCount = 0;
            
            while (queue && queue.length > 0) {
                const queuedMessage = queue.shift()!;
                processedCount++;
                
                console.log(`🔄 [Sofia AI] Processing message ${processedCount} for chat ${chatId}: "${queuedMessage.text.substring(0, 50)}"`);
                
                // Process single message (existing handleMessage function)
                // Note: handleMessage has its own typing management, but our persistent indicator continues
                try {
                    await handleMessage(bot, restaurantId, chatId, queuedMessage.text, restaurant);
                    console.log(`✅ [Sofia AI] Message ${processedCount} processed successfully for chat ${chatId}`);
                } catch (messageError) {
                    console.error(`❌ [Sofia AI] Error processing message ${processedCount} for chat ${chatId}:`, messageError);
                    
                    // Send error message to user
                    try {
                        const errorMsg = restaurant.name ? 
                            `I'm sorry, I encountered an issue processing your message. Please try again.` :
                            `Извините, произошла ошибка при обработке сообщения. Попробуйте еще раз.`;
                        await bot.sendMessage(chatId, errorMsg);
                    } catch (sendError) {
                        console.error(`❌ [Sofia AI] Could not send error message to chat ${chatId}:`, sendError);
                    }
                }
                
                // Small delay between messages in queue to prevent overwhelming
                if (queue.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            console.log(`🏁 [Sofia AI] Completed processing ${processedCount} messages for chat ${chatId}`);
            
        } catch (error) {
            console.error(`❌ [Sofia AI] Critical error in message queue processing for chat ${chatId}:`, error);
        } finally {
            // 🚨 CRITICAL: Always stop typing indicator when queue processing is done
            stopQueueTypingIndicator(chatId);
            
            // Always clean up locks
            processingLocks.delete(chatId);
            activePromises.delete(chatId);
            
            // Clean up empty queues
            const remainingQueue = messageQueues.get(chatId);
            if (remainingQueue && remainingQueue.length === 0) {
                messageQueues.delete(chatId);
            }
        }
    })();
    
    activePromises.set(chatId, processingPromise);
    return processingPromise;
}

async function handleMessage(bot: TelegramBot, restaurantId: number, chatId: number, text: string, restaurant: Restaurant) {
    const restaurantTimezone = restaurant.timezone || 'Europe/Belgrade'; // Use correct default
    let currentLang: Language = 'en';
    const defaultRestaurantName = restaurant.name || (currentLang === 'ru' ? "Наш Ресторан" : currentLang === 'sr' ? "Naš Restoran" : "Our Restaurant");

    // Get or create session
    let sessionId = telegramSessions.get(chatId);
    if (!sessionId) {
        currentLang = 'auto';

        // CRITICAL FIX: Load tenant context before creating session
        const tenantContext = await tenantContextManager.loadContext(restaurantId);
        if (!tenantContext) {
            console.error(`CRITICAL: Could not load tenant context for restaurant ${restaurantId}`);
            await bot.sendMessage(chatId, "I'm sorry, there was a problem connecting. Please try again later.");
            return;
        }

        // ASYNC FIX: Add 'await' here because createSession is now an async function
        sessionId = await enhancedConversationManager.createSession({
            restaurantId,
            platform: 'telegram',
            language: currentLang,
            telegramUserId: chatId.toString(),
            tenantContext: tenantContext // CRITICAL FIX: Pass tenant context
        });

        telegramSessions.set(chatId, sessionId);
        console.log(`🎯 [Sofia AI] Created new Telegram session ${sessionId} for chat ${chatId} with language: auto-detect, timezone: ${restaurantTimezone}`);
    }

    // Get current session to check language
    const session = enhancedConversationManager.getSession(sessionId);
    if (session) {
        currentLang = session.language;
    }

    const restaurantName = restaurant.name || defaultRestaurantName;
    const locale = telegramLocaleStrings[currentLang] || telegramLocaleStrings.en;

    // ✅ UX IMPROVEMENT: Start repeating "typing" indicator
    // This shows users that Sofia is processing their message during the 5-8 second delays
    const typingInterval = setInterval(() => bot.sendChatAction(chatId, 'typing'), 4500);

    // ✅ ROBUST ERROR HANDLING: Wrap entire logic in try...finally block
    try {
        // The original try...catch block remains inside
        try {
            console.log(`📱 [Sofia AI] Processing Telegram message from ${chatId} (lang: ${currentLang}, timezone: ${restaurantTimezone}): "${text}"`);

            // Handle message with enhanced conversation manager
            const result = await enhancedConversationManager.handleMessage(sessionId, text);

            // Update language from session (may have changed during processing)
            const updatedSession = enhancedConversationManager.getSession(sessionId);
            if (updatedSession) {
                currentLang = updatedSession.language;
            }

            console.log(`🔍 [Sofia AI] Enhanced conversation result (lang: ${currentLang}, timezone: ${restaurantTimezone}):`, {
                hasBooking: result.hasBooking,
                reservationId: result.reservationId,
                blocked: result.blocked,
                blockReason: result.blockReason,
                currentStep: result.session.currentStep,
                gatheringInfo: result.session.gatheringInfo
            });

            // ✅ ENHANCED: Check for name clarification needed
            const pendingConfirmation = result.session.pendingConfirmation;
            if (pendingConfirmation?.functionContext?.error?.details?.dbName &&
                pendingConfirmation?.functionContext?.error?.details?.requestName) {

                const { dbName, requestName } = pendingConfirmation.functionContext.error.details;
                const locale = telegramLocaleStrings[currentLang] || telegramLocaleStrings.en;

                console.log(`[Telegram] 🔄 Sending name clarification with buttons: DB="${dbName}", Request="${requestName}"`);

                await bot.sendMessage(chatId, locale.nameClarificationPrompt(dbName, requestName), {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: locale.useNewNameButton(requestName),
                                    callback_data: `confirm_name:new:${requestName}`
                                },
                                {
                                    text: locale.useDbNameButton(dbName),
                                    callback_data: `confirm_name:db:${dbName}`
                                }
                            ]
                        ]
                    }
                });

                console.log(`✅ [Sofia AI] Sent name clarification request with buttons to ${chatId}`);
                return;
            }

            // ✅ FIXED: Session now continues after successful booking
            if (result.hasBooking && result.reservationId) {
                await bot.sendMessage(chatId, result.response);
                // Session continues with 'conductor' agent for follow-up requests
                console.log(`✅ [Sofia AI] Telegram reservation confirmed for chat ${chatId}, reservation #${result.reservationId}, session continues`);
                return;
            }

            // Check if blocked
            if (result.blocked) {
                await bot.sendMessage(chatId, result.response);
                console.log(`⚠️ [Sofia AI] Message blocked for chat ${chatId}: ${result.blockReason}`);
                return;
            }

            // Send response
            await bot.sendMessage(chatId, result.response);
            console.log(`✅ [Sofia AI] Sent enhanced response to ${chatId} (lang: ${currentLang}, timezone: ${restaurantTimezone})`);

        } catch (error) {
            console.error('❌ [Sofia AI] Error processing Telegram conversation:', error);
            await bot.sendMessage(chatId, locale.genericError);
        }
    } finally {
        // ✅ CRITICAL: Always clear the interval to stop the typing indicator
        // This runs regardless of whether the try block completed successfully or threw an error
        clearInterval(typingInterval);
    }
}

async function sendWelcomeMessage(bot: TelegramBot, chatId: number, restaurantName: string, lang: Language) {
    const locale = telegramLocaleStrings[lang] || telegramLocaleStrings.en;
    await bot.sendMessage(chatId, locale.welcomeMessage(restaurantName));
}

export async function initializeTelegramBot(restaurantId: number): Promise<boolean> {
    try {
        const existingBotInstance = activeBots.get(restaurantId);
        if (existingBotInstance) {
            console.log(`[Sofia AI] Attempting to stop existing polling for restaurant ${restaurantId}`);
            await existingBotInstance.stopPolling({ cancel: true }).catch(e => console.warn(`[Sofia AI] Error stopping existing bot for restaurant ${restaurantId}: ${e.message}`));
            activeBots.delete(restaurantId);
            console.log(`[Sofia AI] Existing bot polling stopped and removed for restaurant ${restaurantId}`);
        }

        const settings = await storage.getIntegrationSettings(restaurantId, 'telegram');
        const restaurant = await storage.getRestaurant(restaurantId);

        if (!settings?.enabled || !settings?.token || !restaurant) {
            console.log(`⚠️ [Sofia AI] No bot token or restaurant data for restaurant ${restaurantId}. Bot not initialized.`);
            return false;
        }

        const restaurantTimezone = restaurant.timezone || 'Europe/Belgrade'; // Use correct default
        const initialBotLang = (settings.settings as any)?.language === 'ru' ? 'ru' :
            (settings.settings as any)?.language === 'sr' ? 'sr' :
                (settings.settings as any)?.language === 'hu' ? 'hu' :
                    (settings.settings as any)?.language === 'de' ? 'de' :
                        (settings.settings as any)?.language === 'fr' ? 'fr' :
                            (settings.settings as any)?.language === 'es' ? 'es' :
                                (settings.settings as any)?.language === 'it' ? 'it' :
                                    (settings.settings as any)?.language === 'pt' ? 'pt' :
                                        (settings.settings as any)?.language === 'nl' ? 'nl' : 'en';
        const actualRestaurantName = restaurant.name || (
            initialBotLang === 'ru' ? "Наш Ресторан" :
                initialBotLang === 'sr' ? "Naš Restoran" :
                    initialBotLang === 'hu' ? "Éttermünk" :
                        initialBotLang === 'de' ? "Unser Restaurant" :
                            initialBotLang === 'fr' ? "Notre Restaurant" :
                                initialBotLang === 'es' ? "Nuestro Restaurante" :
                                    initialBotLang === 'it' ? "Il nostro Ristorante" :
                                        initialBotLang === 'pt' ? "Nosso Restaurante" :
                                            initialBotLang === 'nl' ? "Ons Restaurant" :
                                                "Our Restaurant"
        );

        console.log(`🚀 [Sofia AI] Initializing enhanced bot for restaurant ${restaurantId} (${actualRestaurantName}) with timezone: ${restaurantTimezone}, default language: ${initialBotLang}`);
        const token = settings.token;
        const bot = new TelegramBot(token, { polling: { interval: 300, params: { timeout: 10 } } });
        activeBots.set(restaurantId, bot);

        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            // Clear any existing session
            const existingSessionId = telegramSessions.get(chatId);
            if (existingSessionId) {
                enhancedConversationManager.endSession(existingSessionId);
                telegramSessions.delete(chatId);
            }

            // ✅ ENHANCED: Use Telegram language hint but let Language Detection Agent decide
            let userLang: Language = initialBotLang; // Default to restaurant's configured language

            // Use Telegram language code as a hint for the Language Detection Agent
            if (msg.from?.language_code) {
                if (msg.from.language_code.startsWith('ru')) {
                    userLang = 'ru';
                } else if (msg.from.language_code.startsWith('sr')) {
                    userLang = 'sr';
                } else if (msg.from.language_code.startsWith('hu')) {
                    userLang = 'hu';
                } else if (msg.from.language_code.startsWith('de')) {
                    userLang = 'de';
                } else if (msg.from.language_code.startsWith('fr')) {
                    userLang = 'fr';
                } else if (msg.from.language_code.startsWith('es')) {
                    userLang = 'es';
                } else if (msg.from.language_code.startsWith('it')) {
                    userLang = 'it';
                } else if (msg.from.language_code.startsWith('pt')) {
                    userLang = 'pt';
                } else if (msg.from.language_code.startsWith('nl')) {
                    userLang = 'nl';
                } else if (msg.from.language_code.startsWith('en')) {
                    userLang = 'en';
                }
                // If no clear match, keep restaurant default (initialBotLang)
            }

            console.log(`🌍 [Sofia AI] /start language detection: Telegram=${msg.from?.language_code}, Hint=${userLang}, RestaurantDefault=${initialBotLang}`);
            await sendWelcomeMessage(bot, chatId, actualRestaurantName, userLang);
        });

        bot.onText(/\/help/, async (msg) => {
            const chatId = msg.chat.id;
            const sessionId = telegramSessions.get(chatId);
            let lang = initialBotLang;

            if (sessionId) {
                const session = enhancedConversationManager.getSession(sessionId);
                lang = session?.language || initialBotLang;
            } else {
                // Use Telegram language code as hint
                if (msg.from?.language_code?.startsWith('ru')) {
                    lang = 'ru';
                } else if (msg.from?.language_code?.startsWith('sr')) {
                    lang = 'sr';
                } else if (msg.from?.language_code?.startsWith('hu')) {
                    lang = 'hu';
                } else if (msg.from?.language_code?.startsWith('de')) {
                    lang = 'de';
                } else if (msg.from?.language_code?.startsWith('fr')) {
                    lang = 'fr';
                } else if (msg.from?.language_code?.startsWith('es')) {
                    lang = 'es';
                } else if (msg.from?.language_code?.startsWith('it')) {
                    lang = 'it';
                } else if (msg.from?.language_code?.startsWith('pt')) {
                    lang = 'pt';
                } else if (msg.from?.language_code?.startsWith('nl')) {
                    lang = 'nl';
                } else {
                    lang = initialBotLang; // Use restaurant default
                }
            }

            const locale = telegramLocaleStrings[lang] || telegramLocaleStrings.en;
            await bot.sendMessage(chatId, locale.helpMessage, { parse_mode: 'Markdown' });
        });

        bot.onText(/\/cancel/, async (msg) => {
            const chatId = msg.chat.id;
            const sessionId = telegramSessions.get(chatId);
            let lang = initialBotLang;

            if (sessionId) {
                const session = enhancedConversationManager.getSession(sessionId);
                lang = session?.language || initialBotLang;
                enhancedConversationManager.endSession(sessionId);
                telegramSessions.delete(chatId);
            } else {
                // Use Telegram language code as hint
                if (msg.from?.language_code?.startsWith('ru')) {
                    lang = 'ru';
                } else if (msg.from?.language_code?.startsWith('sr')) {
                    lang = 'sr';
                } else if (msg.from?.language_code?.startsWith('hu')) {
                    lang = 'hu';
                } else if (msg.from?.language_code?.startsWith('de')) {
                    lang = 'de';
                } else if (msg.from?.language_code?.startsWith('fr')) {
                    lang = 'fr';
                } else if (msg.from?.language_code?.startsWith('es')) {
                    lang = 'es';
                } else if (msg.from?.language_code?.startsWith('it')) {
                    lang = 'it';
                } else if (msg.from?.language_code?.startsWith('pt')) {
                    lang = 'pt';
                } else if (msg.from?.language_code?.startsWith('nl')) {
                    lang = 'nl';
                } else {
                    lang = initialBotLang; // Use restaurant default
                }
            }

            const locale = telegramLocaleStrings[lang] || telegramLocaleStrings.en;
            await bot.sendMessage(chatId, locale.cancelMessage);
        });

        // 🚨 RACE CONDITION FIX: Replace direct message handler with queue-based system
        bot.on('message', async (msg) => {
            if (msg.text && msg.text.startsWith('/')) return;
            if (msg.text && msg.chat.id) {
                // 🚨 FIX: Enqueue message instead of processing directly
                enqueueMessage(msg.chat.id, msg.text, msg);
                
                // Process queue (handles concurrent calls safely)
                // Note: This will start typing indicator immediately for better UX
                processMessageQueue(msg.chat.id, bot, restaurantId, restaurant);
            }
        });

        // ✅ ENHANCED: Better callback query handling for name conflicts
        bot.on('callback_query', async (callbackQuery) => {
            const chatId = callbackQuery.message?.chat.id;
            const messageId = callbackQuery.message?.message_id;
            const data = callbackQuery.data;

            if (!chatId || !messageId || !data) {
                console.warn('[Telegram] Invalid callback_query');
                if (callbackQuery.id) await bot.answerCallbackQuery(callbackQuery.id);
                return;
            }

            const sessionId = telegramSessions.get(chatId);
            if (!sessionId) {
                console.warn('[Telegram] No active session for callback');
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Session expired. Please start a new conversation." });
                return;
            }

            const session = enhancedConversationManager.getSession(sessionId);
            if (!session) {
                console.warn('[Telegram] Session not found for callback');
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Session not found. Please start a new conversation." });
                return;
            }

            const currentLang = session.language;
            const locale = telegramLocaleStrings[currentLang] || telegramLocaleStrings.en;

            console.log(`[Telegram] Callback query received: ${data} from chat ${chatId} (timezone: ${restaurantTimezone})`);

            if (data.startsWith('confirm_name:')) {
                const parts = data.split(':');
                const choiceType = parts[1]; // 'new' or 'db'
                const chosenName = parts[2]; // The actual name

                console.log(`[Telegram] ✅ Name choice received: ${choiceType} -> "${chosenName}"`);

                try {
                    // Answer the callback query immediately
                    await bot.answerCallbackQuery(callbackQuery.id, {
                        text: locale.nameConfirmationUsed(chosenName)
                    });

                    // Remove the buttons by editing the message
                    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                        chat_id: chatId,
                        message_id: messageId
                    });

                    // Send confirmation message
                    await bot.sendMessage(chatId, locale.nameConfirmationUsed(chosenName));

                    // ✅ CRITICAL: Send the name choice as a regular message to conversation manager
                    // This will trigger the name choice extraction logic in enhanced-conversation-manager.ts
                    // 🚨 RACE CONDITION FIX: Use queue system for callback-triggered messages too
                    enqueueMessage(chatId, chosenName, callbackQuery.message as TelegramBot.Message);
                    processMessageQueue(chatId, bot, restaurantId, restaurant);

                } catch (editError: any) {
                    console.warn(`[Telegram] Could not edit message or answer callback query: ${editError.message || editError}`);

                    // Fallback: still try to process the name choice
                    try {
                        await bot.sendMessage(chatId, locale.nameConfirmationUsed(chosenName));
                        // 🚨 RACE CONDITION FIX: Use queue system for fallback too
                        enqueueMessage(chatId, chosenName, callbackQuery.message as TelegramBot.Message);
                        processMessageQueue(chatId, bot, restaurantId, restaurant);
                    } catch (fallbackError: any) {
                        console.error(`[Telegram] Fallback handling also failed: ${fallbackError.message || fallbackError}`);
                    }
                }
            } else {
                // Handle other callback queries
                await bot.answerCallbackQuery(callbackQuery.id);
            }
        });

        bot.on('polling_error', (error) => {
            console.error(`❌ [Sofia AI] Polling error for restaurant ${restaurantId} (${actualRestaurantName}, ${restaurantTimezone}):`, error.message);
            if ((error as any).code === 'ETELEGRAM' && (error as any).response?.body?.error_code === 401) {
                console.error(`[Sofia AI] BOT TOKEN INVALID for restaurant ${restaurantId}. Stopping bot.`);
                stopTelegramBot(restaurantId);
            }
        });

        bot.on('error', (error) => console.error(`❌ [Sofia AI] General Bot error for restaurant ${restaurantId} (${actualRestaurantName}, ${restaurantTimezone}):`, error.message));

        console.log(`✅ [Sofia AI] Enhanced conversation bot initialized and listening for restaurant ${restaurantId} (${actualRestaurantName}) with timezone: ${restaurantTimezone}, default language: ${initialBotLang}`);
        return true;

    } catch (error) {
        console.error(`❌ [Telegram] Failed to initialize enhanced bot for restaurant ${restaurantId}:`, error);
        if (activeBots.has(restaurantId)) {
            activeBots.delete(restaurantId);
        }
        return false;
    }
}

export function stopTelegramBot(restaurantId: number): void {
    const bot = activeBots.get(restaurantId);
    if (bot) {
        console.log(`[Telegram] Stopping enhanced bot polling for restaurant ${restaurantId}...`);
        bot.stopPolling({ cancel: true })
            .then(() => { console.log(`🛑 [Telegram] Enhanced bot stopped for restaurant ${restaurantId}`); })
            .catch(err => console.error(`Error stopping enhanced bot for restaurant ${restaurantId}:`, err.message || err));
        activeBots.delete(restaurantId);

        // Clear all sessions for this restaurant
        for (const [chatId, sessionId] of telegramSessions.entries()) {
            const session = enhancedConversationManager.getSession(sessionId);
            if (session && session.restaurantId === restaurantId) {
                enhancedConversationManager.endSession(sessionId);
                telegramSessions.delete(chatId);
            }
        }
    } else {
        console.log(`[Telegram] No active enhanced bot found for restaurant ${restaurantId} to stop.`);
    }
}

export async function initializeAllTelegramBots(): Promise<void> {
    try {
        const restaurantsToInit = await db.select({
            id: schemaRestaurants.id,
        })
            .from(schemaRestaurants)
            .innerJoin(schemaIntegrationSettings, eq(schemaRestaurants.id, schemaIntegrationSettings.restaurantId))
            .where(and(eq(schemaIntegrationSettings.type, 'telegram'), eq(schemaIntegrationSettings.enabled, true)));

        console.log(`[Telegram] Found ${restaurantsToInit.length} restaurants with Telegram integration enabled.`);
        for (const restaurantData of restaurantsToInit) {
            if (restaurantData.id) {
                await initializeTelegramBot(restaurantData.id);
            } else {
                console.warn(`[Telegram] Skipping initialization for a restaurant due to missing ID. Data:`, restaurantData);
            }
        }
        console.log(`🌟 [Sofia AI] All relevant restaurant enhanced bots processed for initialization.`);
    } catch (error: any) {
        console.error('❌ [Telegram] Failed to initialize all enhanced bots:', error.message || error);
    }
}

export function cleanupTelegramBots(): void {
    console.log(`🧹 [Telegram] Cleaning up ${activeBots.size} active enhanced bots...`);
    
    // 🚨 RACE CONDITION FIX: Clear message queues during cleanup
    messageQueues.clear();
    processingLocks.clear();
    activePromises.clear();
    console.log(`🧹 [Telegram] Message queues cleared`);
    
    // 🚨 UX FIX: Clear all active typing indicators
    for (const [chatId, typingInterval] of activeTypingIntervals.entries()) {
        clearInterval(typingInterval);
        console.log(`🧹 [Telegram] Cleared typing indicator for chat ${chatId}`);
    }
    activeTypingIntervals.clear();
    console.log(`🧹 [Telegram] All typing indicators cleared`);
    
    for (const [restaurantId, bot] of activeBots.entries()) {
        try {
            console.log(`[Telegram] Stopping polling for enhanced bot of restaurant ${restaurantId} during cleanup.`);
            bot.stopPolling({ cancel: true })
                .then(() => console.log(`[Telegram] Enhanced bot for restaurant ${restaurantId} stopped during cleanup.`))
                .catch(err => console.error(`Error stopping enhanced bot during cleanup for restaurant ${restaurantId}:`, err.message || err));
        } catch (error: any) {
            console.error(`❌ [Telegram] Error stopping enhanced bot for restaurant ${restaurantId} during cleanup:`, error.message || error);
        }
    }
    activeBots.clear();
    telegramSessions.clear();
    console.log(`✅ [Telegram] Enhanced cleanup completed. Active bots: ${activeBots.size}, Active sessions: ${telegramSessions.size}, Message queues: ${messageQueues.size}, Typing indicators: ${activeTypingIntervals.size}`);
}

export function getTelegramBot(restaurantId: number): TelegramBot | undefined {
    return activeBots.get(restaurantId);
}

export async function sendTelegramMessage(
    restaurantId: number,
    chatId: number,
    message: string
): Promise<boolean> {
    try {
        const bot = activeBots.get(restaurantId);
        if (!bot) {
            console.error(`❌ [Telegram] No enhanced bot found for restaurant ${restaurantId}`);
            return false;
        }
        await bot.sendMessage(chatId, message);
        return true;
    } catch (error: any) {
        console.error(`❌ [Telegram] Failed to send message to chat ${chatId} for restaurant ${restaurantId}:`, error.message || error);
        return false;
    }
}

export function getConversationStats(): {
    activeConversations: number;
    activeBots: number;
    conversationsByStage: Record<string, number>;
} {
    const stats = enhancedConversationManager.getStats();
    const conversationsByStage: Record<string, number> = {};

    // Count Telegram sessions by stage
    for (const sessionId of telegramSessions.values()) {
        const session = enhancedConversationManager.getSession(sessionId);
        if (session) {
            conversationsByStage[session.currentStep] = (conversationsByStage[session.currentStep] || 0) + 1;
        }
    }

    return {
        activeConversations: telegramSessions.size,
        activeBots: activeBots.size,
        conversationsByStage
    };
}