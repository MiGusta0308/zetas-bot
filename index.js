require("dotenv").config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionFlagsBits, EmbedBuilder, MessageFlags 
} = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

// Konfiguracja
const CONFIG = {
    WELCOME_CHANNEL_ID: '1467588026086719739',
    GOODBYE_CHANNEL_ID: '1467604060617314498',
    ADMIN_ROLE_ID: '1467935721707802675',
    APPLICATION_CATEGORY_ID: '1467935963018825941',
    HELP_CATEGORY_ID: '1467973590791094436',
    TICKET_CHANNEL_1_ID: '1467923669186510951',
    TICKET_CHANNEL_2_ID: '1467590287990718655',
    REQUIREMENTS_CHANNEL_ID: '1467923593513144320'
};

// Cache dla istniejących ticketów
const userTicketCache = new Map();

client.on('ready', () => {
    console.log(`Zalogowano jako ${client.user.tag}`);
    console.log(`Bot działa na ${client.guilds.cache.size} serwerach`);
    
    // Inicjalizacja cache przy starcie
    initializeTicketCache();
});

// Inicjalizacja cache ticketów
async function initializeTicketCache() {
    userTicketCache.clear();
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const categories = [CONFIG.APPLICATION_CATEGORY_ID, CONFIG.HELP_CATEGORY_ID];
    
    for (const categoryId of categories) {
        const category = guild.channels.cache.get(categoryId);
        if (!category) continue;
        
        const channels = category.children.cache.filter(ch => ch.type === ChannelType.GuildText);
        
        for (const channel of channels.values()) {
            if (channel.topic) {
                userTicketCache.set(channel.topic, channel.id);
            }
        }
    }
    
    console.log(`Zainicjalizowano cache: ${userTicketCache.size} ticketów`);
}

// Event dla członków dołączających
client.on('guildMemberAdd', async member => {
    console.log("Dołączył:", member.user.tag);
    
    const channel = member.guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    const welcomeEmbed = new EmbedBuilder()
        .setTitle(`👋 Welcome to ZETAS server!`)
        .setDescription(`Hi ${member.user}, it's nice to see you on our server!`)
        .setColor(0x00ff00)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: 'ZETAS Community' });

    try {
        await channel.send({ embeds: [welcomeEmbed] });
    } catch (error) {
        console.error('Błąd przy wysyłaniu powitania:', error);
    }
});

// Event dla członków opuszczających
client.on('guildMemberRemove', async member => {
    console.log("Opuscil:", member.user.tag);

    const channel = member.guild.channels.cache.get(CONFIG.GOODBYE_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;

    const leaveEmbed = new EmbedBuilder()
        .setTitle('Bye👋')
        .setDescription(`We didn't need you anyways ${member.user} 🤡`)
        .setColor(0xff0000)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: 'ZETAS Community' });

    try {
        await channel.send({ embeds: [leaveEmbed] });
    } catch (error) {
        console.error('Błąd przy wysyłaniu pożegnania:', error);
    }
});

// Główna obsługa interakcji
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
        }
    } catch (error) {
        console.error('Nieobsłużony błąd w interakcji:', error);
        
        // Spróbuj wysłać informację o błędzie, jeśli to możliwe
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({
                    content: 'Wystąpił nieoczekiwany błąd. Spróbuj ponownie później.',
                    flags: MessageFlags.Ephemeral
                });
            } catch (replyError) {
                console.error('Nie można wysłać odpowiedzi o błędzie:', replyError);
            }
        }
    }
});

// Obsługa przycisków
async function handleButtonInteraction(interaction) {
    // Sprawdź czy interakcja została już obsłużona
    if (interaction.replied || interaction.deferred) {
        console.log('Interakcja już obsłużona:', interaction.customId);
        return;
    }

    const { customId, user, guild, channel } = interaction;
    
    // Defer odpowiedź dla wszystkich przycisków
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    switch (customId) {
        case 'create_ticket':
            await handleCreateTicket(interaction, 'application');
            break;
            
        case 'create_ticket_help':
            await handleCreateTicket(interaction, 'help');
            break;
            
        case 'close_ticket':
            await handleCloseTicket(interaction);
            break;
            
        default:
            await interaction.editReply({
                content: 'Nieznany przycisk. Skontaktuj się z administracją.'
            });
    }
}

// Tworzenie ticketu
async function handleCreateTicket(interaction, type) {
    const { user, guild } = interaction;
    
    // Sprawdź czy użytkownik ma już otwarty ticket
    const existingTicketId = userTicketCache.get(user.id);
    if (existingTicketId) {
        const existingChannel = guild.channels.cache.get(existingTicketId);
        if (existingChannel) {
            return interaction.editReply({
                content: `Masz już otwarty ticket: ${existingChannel}.`
            });
        } else {
            // Usuń z cache jeśli kanał nie istnieje
            userTicketCache.delete(user.id);
        }
    }

    // Konfiguracja w zależności od typu
    let config;
    if (type === 'application') {
        config = {
            categoryId: CONFIG.APPLICATION_CATEGORY_ID,
            title: `${user.username}'s Application Ticket`,
            description: `Please read the requirements in <#${CONFIG.REQUIREMENTS_CHANNEL_ID}> and answer the questions in this ticket:\n\n1.\n2.\n3.`
        };
    } else {
        config = {
            categoryId: CONFIG.HELP_CATEGORY_ID,
            title: `${user.username}'s Help Ticket`,
            description: `Welcome to the help ticket! Please describe your issue in detail and our support team will assist you shortly.`
        };
    }

    try {
        // Sprawdź czy kategoria istnieje
        const category = guild.channels.cache.get(config.categoryId);
        if (!category) {
            return interaction.editReply({
                content: 'Błąd: Kategoria ticketów nie została znaleziona.'
            });
        }

        // Utwórz kanał ticketu
        const ticketChannel = await guild.channels.create({
            name: `${type}-${user.username}`.toLowerCase().replace(/[^a-z0-9\-]/g, '-'),
            type: ChannelType.GuildText,
            parent: config.categoryId,
            topic: user.id,
            permissionOverwrites: [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: CONFIG.ADMIN_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ],
        });

        // Dodaj do cache
        userTicketCache.set(user.id, ticketChannel.id);

        // Przycisk zamknięcia
        const closeButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒')
        );

        // Embed ticketu
        const ticketEmbed = new EmbedBuilder()
            .setTitle(config.title)
            .setDescription(config.description)
            .setColor(type === 'application' ? 0x0099ff : 0x00ff00)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Created by', value: user.tag, inline: true },
                { name: 'Type', value: type === 'application' ? 'Application' : 'Help', inline: true },
                { name: 'Created at', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
            )
            .setTimestamp()
            .setFooter({ 
                text: 'ZETAS Support', 
                iconURL: client.user.displayAvatarURL() 
            });

        // Wspomnienia
        const creatorMention = `<@${user.id}>`;
        const adminMention = `<@&${CONFIG.ADMIN_ROLE_ID}>`;

        // Wyślij wiadomość na kanale ticketu
        await ticketChannel.send({
            content: `${creatorMention} ${adminMention}`,
            embeds: [ticketEmbed],
            components: [closeButton]
        });

        // Odpowiedz użytkownikowi
        await interaction.editReply({
            content: `Twój ticket został utworzony: ${ticketChannel}`
        });

        console.log(`Utworzono ticket ${type} dla ${user.tag}: ${ticketChannel.id}`);

    } catch (error) {
        console.error('Błąd przy tworzeniu ticketu:', error);
        
        await interaction.editReply({
            content: 'Wystąpił błąd przy tworzeniu ticketu. Spróbuj ponownie lub skontaktuj się z administracją.'
        });
    }
}

// Zamykanie ticketu
async function handleCloseTicket(interaction) {
    const { member, channel, guild } = interaction;
    
    // Sprawdź uprawnienia
    if (!member.roles.cache.has(CONFIG.ADMIN_ROLE_ID)) {
        return interaction.editReply({
            content: "❌ Only Administration can close tickets!"
        });
    }

    try {
        // Pobierz ID użytkownika z tematu kanału
        const ticketUserId = channel.topic;
        
        // Wyślij DM do użytkownika jeśli to możliwe
        if (ticketUserId) {
            const ticketUser = await client.users.fetch(ticketUserId).catch(() => null);
            
            if (ticketUser) {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('🎫 Ticket Closed')
                    .setDescription(`Your ticket in **${guild.name}** has been closed by ${member.user.tag}`)
                    .addFields(
                        { name: 'Ticket Channel', value: `#${channel.name}`, inline: true },
                        { name: 'Closed at', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                    )
                    .setColor(0xff0000)
                    .setTimestamp()
                    .setFooter({ text: 'ZETAS Support' });

                await ticketUser.send({ embeds: [dmEmbed] }).catch(() => {
                    console.log(`Nie udało się wysłać DM do ${ticketUserId}`);
                });
            }
            
            // Usuń z cache
            userTicketCache.delete(ticketUserId);
        }

        // Usuń kanał
        await channel.delete('Ticket closed by admin');
        
        // Nie edytuj odpowiedzi bo kanał został usunięty
        // Discord automatycznie obsłuży to w tle
        
        console.log(`Zamknięto ticket: ${channel.name} przez ${member.user.tag}`);

    } catch (error) {
        console.error('Błąd przy zamykaniu ticketu:', error);
        
        if (error.code === 10003) { // Unknown Channel
            // Kanał już został usunięty
            if (ticketUserId) {
                userTicketCache.delete(ticketUserId);
            }
            return;
        }
        
        // Spróbuj wysłać informację o błędzie
        try {
            await interaction.editReply({
                content: `Wystąpił błąd: ${error.message}`
            });
        } catch (replyError) {
            console.error('Nie można wysłać odpowiedzi o błędzie:', replyError);
        }
    }
}

// Inicjalizacja paneli ticketów (uruchamiane tylko raz)
let panelsInitialized = false;

client.once('ready', async () => {
    if (panelsInitialized) return;
    panelsInitialized = true;
    
    console.log("Inicjalizacja paneli ticketów...");
    
    try {
        // Panel 1: Application Tickets
        const channel1 = await client.channels.fetch(CONFIG.TICKET_CHANNEL_1_ID);
        if (channel1) {
            await initializeTicketPanel(channel1, 'application', 'Want to join ZETAS?');
        }

        // Panel 2: Help Tickets
        const channel2 = await client.channels.fetch(CONFIG.TICKET_CHANNEL_2_ID);
        if (channel2) {
            await initializeTicketPanel(channel2, 'help', 'Do you need help?');
        }
        
        console.log("Panele ticketów zainicjalizowane pomyślnie");
    } catch (error) {
        console.error('Błąd przy inicjalizacji paneli:', error);
    }
});

// Funkcja do inicjalizacji paneli
async function initializeTicketPanel(channel, type, title) {
    // Sprawdź czy w kanale już są wiadomości z przyciskami
    const messages = await channel.messages.fetch({ limit: 10 });
    const existingPanel = messages.find(msg => 
        msg.embeds.length > 0 && 
        msg.components.length > 0 &&
        msg.author.id === client.user.id
    );

    if (existingPanel) {
        console.log(`Panel ${type} już istnieje w ${channel.name}`);
        return;
    }

    const buttonId = type === 'application' ? 'create_ticket' : 'create_ticket_help';
    const buttonLabel = type === 'application' ? 'Apply Now' : 'Get Help';
    const description = type === 'application' 
        ? 'Click the button below to create a new application ticket!'
        : 'Click the button below to create a help ticket!';

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(type === 'application' ? 0x0099ff : 0x00ff00)
        .setThumbnail('https://cdn.discordapp.com/attachments/1467943172306112534/1467949329817014312/0b6381438e644bf194f5a334fa8923d0tplv-jj85edgx6n-image-medium.jpeg')
        .setTimestamp()
        .setFooter({ text: 'ZETAS Support', iconURL: client.user.displayAvatarURL() });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(buttonId)
            .setLabel(buttonLabel)
            .setStyle(ButtonStyle.Primary)
            .setEmoji(type === 'application' ? '📝' : '❓')
    );

    await channel.send({ embeds: [embed], components: [row] });
}

// Obsługa błędów procesu
process.on('unhandledRejection', error => {
    console.error('Nieobsłużony błąd Promise:', error);
});

process.on('uncaughtException', error => {
    console.error('Nieobsłużony wyjątek:', error);
});

// Login bota
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Błąd przy logowaniu:', error);
    process.exit(1);
});
