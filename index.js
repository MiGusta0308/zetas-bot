require("dotenv").config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionFlagsBits, EmbedBuilder, MessageFlags,
    SlashCommandBuilder, Routes, REST
} = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

// ================================
// KONFIGURACJA
// ================================
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

// ================================
// SYSTEM TICKETÓW
// ================================

// Cache dla istniejących ticketów
const userTicketCache = new Map();

// Cache dla tymczasowych ról (pamięć RAM)
const temporaryRoles = new Map();

// Timer do sprawdzania wygasłych ról
let roleCheckInterval;

// ================================
// FUNKCJE POMOCNICZE DLA TYMCZASOWYCH RÓL
// ================================

/**
 * Dodaje tymczasową rolę do pamięci
 */
function addTemporaryRole(guildId, userId, roleId, durationDays, assignedBy, reason = '') {
    if (!temporaryRoles.has(guildId)) {
        temporaryRoles.set(guildId, new Map());
    }
    
    const guildRoles = temporaryRoles.get(guildId);
    if (!guildRoles.has(userId)) {
        guildRoles.set(userId, []);
    }
    
    const expiresAt = Date.now() + (durationDays * 24 * 60 * 60 * 1000);
    
    guildRoles.get(userId).push({
        roleId,
        expiresAt,
        assignedBy,
        reason,
        assignedAt: Date.now()
    });
    
    console.log(`➕ Dodano tymczasową rolę: ${roleId} dla ${userId} na ${durationDays} dni`);
}

/**
 * Usuwa tymczasową rolę z pamięci
 */
function removeTemporaryRole(guildId, userId, roleId) {
    const guildRoles = temporaryRoles.get(guildId);
    if (!guildRoles) return false;
    
    const userRoles = guildRoles.get(userId);
    if (!userRoles) return false;
    
    const initialLength = userRoles.length;
    const filteredRoles = userRoles.filter(role => role.roleId !== roleId);
    
    if (filteredRoles.length === 0) {
        guildRoles.delete(userId);
    } else {
        guildRoles.set(userId, filteredRoles);
    }
    
    if (guildRoles.size === 0) {
        temporaryRoles.delete(guildId);
    }
    
    console.log(`➖ Usunięto tymczasową rolę z pamięci: ${roleId} od ${userId}`);
    return filteredRoles.length < initialLength;
}

/**
 * Sprawdza wygasłe role i automatycznie je usuwa
 */
async function checkExpiredRoles() {
    const now = Date.now();
    
    for (const [guildId, guildRoles] of temporaryRoles) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        
        for (const [userId, roles] of guildRoles) {
            for (const roleData of [...roles]) { // Kopiujemy array, bo będziemy modyfikować
                if (roleData.expiresAt <= now) {
                    try {
                        const member = await guild.members.fetch(userId).catch(() => null);
                        if (member && member.roles.cache.has(roleData.roleId)) {
                            await member.roles.remove(roleData.roleId);
                            console.log(`⏰ Automatycznie usunięto wygasłą rolę ${roleData.roleId} od ${member.user.tag}`);
                            
                            // Powiadomienie DM
                            try {
                                const user = await client.users.fetch(userId);
                                const embed = new EmbedBuilder()
                                    .setTitle('⏰ Role expired')
                                    .setDescription(`Your role <@&${roleData.roleId}> on server **${guild.name}** has expired.`)
                                    .setColor(0xff9900)
                                    .setTimestamp();
                                
                                await user.send({ embeds: [embed] }).catch(() => {});
                            } catch (dmError) {
                                // Użytkownik ma wyłączone DM
                            }
                        }
                        
                        // Usuń z pamięci
                        removeTemporaryRole(guildId, userId, roleData.roleId);
                        
                    } catch (error) {
                        console.error(`❌ Błąd przy usuwaniu roli ${roleData.roleId}:`, error);
                        // Jeśli rola nie istnieje, usuń z pamięci
                        if (error.code === 10011 || error.code === 10007) {
                            removeTemporaryRole(guildId, userId, roleData.roleId);
                        }
                    }
                }
            }
        }
    }
}

/**
 * Pokazuje ile czasu pozostało do wygaśnięcia
 */
function getTimeRemaining(expiresAt) {
    const now = Date.now();
    const remainingMs = expiresAt - now;
    
    if (remainingMs <= 0) return 'EXPIRED';
    
    const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes} minutes`;
}

// ================================
// FUNKCJE DLA SYSTEMU TICKETÓW
// ================================

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
    
    console.log(`📊 Zainicjalizowano cache: ${userTicketCache.size} ticketów`);
}

// ================================
// EVENTY
// ================================

client.on('ready', () => {
    console.log(`✅ Zalogowano jako ${client.user.tag}`);
    console.log(`🌐 Bot działa na ${client.guilds.cache.size} serwerach`);
    
    // Inicjalizacja cache ticketów przy starcie
    initializeTicketCache();
    
    // Start timer do sprawdzania wygasłych ról (co minutę)
    roleCheckInterval = setInterval(checkExpiredRoles, 60000);
    console.log('⏰ Timer sprawdzania wygasłych ról uruchomiony (co 60s)');
    
    // Rejestracja komend slash
    registerCommands();
});

// Event dla członków dołączających
client.on('guildMemberAdd', async member => {
    console.log("👋 Dołączył:", member.user.tag);
    
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
        console.error('❌ Błąd przy wysyłaniu powitania:', error);
    }
});

// Event dla członków opuszczających
client.on('guildMemberRemove', async member => {
    console.log("👋 Opuscil:", member.user.tag);

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
        console.error('❌ Błąd przy wysyłaniu pożegnania:', error);
    }
});

// ================================
// OBSŁUGA INTERAKCJI (TICKETY + KOMENDY)
// ================================

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
        } else if (interaction.isCommand()) {
            await handleCommandInteraction(interaction);
        }
    } catch (error) {
        console.error('❌ Nieobsłużony błąd w interakcji:', error);
        
        // Spróbuj wysłać informację o błędzie, jeśli to możliwe
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            try {
                await interaction.reply({
                    content: 'An unexpected error has occured. Try again later.',
                    flags: MessageFlags.Ephemeral
                });
            } catch (replyError) {
                console.error('❌ Nie można wysłać odpowiedzi o błędzie:', replyError);
            }
        }
    }
});

// Obsługa przycisków (tickety)
async function handleButtonInteraction(interaction) {
    // Sprawdź czy interakcja została już obsłużona
    if (interaction.replied || interaction.deferred) {
        console.log('⚠️ Interakcja już obsłużona:', interaction.customId);
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
                content: 'Unknown button. Contact with Administration.'
            });
    }
}

// Obsługa komend slash (tymczasowe role)
async function handleCommandInteraction(interaction) {
    const { commandName, options, member, guild } = interaction;

    // 1. KOMENDA: /temprole - nadaj tymczasową rolę
    if (commandName === 'temprole') {
        // Sprawdź uprawnienia (tylko administratorzy)
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need administrator permissions to use this command!',
                flags: MessageFlags.Ephemeral
            });
        }

        const targetUser = options.getUser('user');
        const targetRole = options.getRole('role');
        const duration = options.getInteger('duration'); // w dniach
        const reason = options.getString('reason') || 'No reason provided';

        // Walidacja czasu
        if (duration < 1 || duration > 365) {
            return interaction.reply({
                content: '❌ Duration must be between 1 and 365 days!',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            // Sprawdź czy bot może nadać tę rolę
            const botMember = await guild.members.fetch(client.user.id);
            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return interaction.reply({
                    content: '❌ Bot does not have permissions to manage roles!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Sprawdź hierarchię ról
            const botHighestRole = botMember.roles.highest.position;
            const targetHighestRole = member.roles.highest.position;
            const rolePosition = targetRole.position;

            if (rolePosition >= botHighestRole) {
                return interaction.reply({
                    content: '❌ I cannot give a role higher than my highest role!',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (rolePosition >= targetHighestRole && member.id !== guild.ownerId) {
                return interaction.reply({
                    content: '❌ You cannot give a role higher than your highest role!',
                    flags: MessageFlags.Ephemeral
                });
            }

            // Nadaj rolę użytkownikowi
            const targetMember = await guild.members.fetch(targetUser.id);
            await targetMember.roles.add(targetRole.id);

            // Zapisz w pamięci RAM
            addTemporaryRole(guild.id, targetUser.id, targetRole.id, duration, member.id, reason);

            // Oblicz datę wygaśnięcia
            const expiresAt = new Date(Date.now() + (duration * 24 * 60 * 60 * 1000));

            // Embed potwierdzenia
            const embed = new EmbedBuilder()
                .setTitle('✅ Temporary role assigned')
                .setColor(0x00ff00)
                .addFields(
                    { name: '👤 User', value: `<@${targetUser.id}>`, inline: true },
                    { name: '🎭 Role', value: `<@&${targetRole.id}>`, inline: true },
                    { name: '⏱️ Duration', value: `${duration} days`, inline: true },
                    { name: '📅 Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:F>`, inline: false },
                    { name: '👑 Assigned by', value: `<@${member.id}>`, inline: true },
                    { name: '📝 Reason', value: reason, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'ZETAS Temporary Roles System' });

            await interaction.reply({ embeds: [embed] });

            // Powiadomienie DM
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('🎭 You received a temporary role')
                    .setDescription(`On server **${guild.name}** you received role **${targetRole.name}**`)
                    .setColor(0x0099ff)
                    .addFields(
                        { name: 'Duration', value: `${duration} days`, inline: true },
                        { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true },
                        { name: 'Assigned by', value: member.user.tag, inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setTimestamp();

                await targetUser.send({ embeds: [dmEmbed] });
            } catch (dmError) {
                console.log(`⚠️ Could not send DM to ${targetUser.tag}`);
            }

        } catch (error) {
            console.error('❌ Error:', error);
            await interaction.reply({
                content: `❌ Error: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }

    // 2. KOMENDA: /myroles - pokaż swoje tymczasowe role
    else if (commandName === 'myroles') {
        const guildRoles = temporaryRoles.get(guild.id);
        const userRoles = guildRoles ? guildRoles.get(interaction.user.id) : null;
        
        if (!userRoles || userRoles.length === 0) {
            return interaction.reply({
                content: 'You do not have any active temporary roles.',
                flags: MessageFlags.Ephemeral
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🎭 Your temporary roles')
            .setColor(0x0099ff)
            .setDescription(`You have **${userRoles.length}** active temporary roles:`);

        for (const roleData of userRoles) {
            const role = guild.roles.cache.get(roleData.roleId);
            const timeRemaining = getTimeRemaining(roleData.expiresAt);
            
            embed.addFields({
                name: role ? role.name : 'Unknown role',
                value: `⏰ Remaining: **${timeRemaining}**\n📝 Reason: ${roleData.reason}`,
                inline: true
            });
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // 3. KOMENDA: /roletime - sprawdź czas pozostały dla roli
    else if (commandName === 'roletime') {
        const targetUser = options.getUser('user') || interaction.user;
        const targetRole = options.getRole('role');
        
        const guildRoles = temporaryRoles.get(guild.id);
        if (!guildRoles) {
            return interaction.reply({
                content: 'No temporary roles on this server.',
                flags: MessageFlags.Ephemeral
            });
        }
        
        const userRoles = guildRoles.get(targetUser.id);
        if (!userRoles) {
            return interaction.reply({
                content: 'This user does not have temporary roles.',
                flags: MessageFlags.Ephemeral
            });
        }
        
        const roleData = userRoles.find(r => r.roleId === targetRole.id);
        if (!roleData) {
            return interaction.reply({
                content: 'This role is not temporary.',
                flags: MessageFlags.Ephemeral
            });
        }
        
        const timeRemaining = getTimeRemaining(roleData.expiresAt);
        const assignedByUser = await client.users.fetch(roleData.assignedBy).catch(() => null);
        
        const embed = new EmbedBuilder()
            .setTitle('⏰ Role time remaining')
            .setColor(timeRemaining === 'EXPIRED' ? 0xff0000 : 0x00ff00)
            .addFields(
                { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                { name: 'Role', value: `<@&${targetRole.id}>`, inline: true },
                { name: 'Remaining', value: timeRemaining, inline: true },
                { name: 'Assigned by', value: assignedByUser ? assignedByUser.tag : 'Unknown', inline: true },
                { name: 'Reason', value: roleData.reason, inline: false }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    }

    // 4. KOMENDA: /removetemp - usuń rolę przed czasem
    else if (commandName === 'removetemp') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need administrator permissions!',
                flags: MessageFlags.Ephemeral
            });
        }
        
        const targetUser = options.getUser('user');
        const targetRole = options.getRole('role');
        
        try {
            // Usuń rolę
            const targetMember = await guild.members.fetch(targetUser.id);
            await targetMember.roles.remove(targetRole.id);
            
            // Usuń z pamięci
            const removed = removeTemporaryRole(guild.id, targetUser.id, targetRole.id);
            
            if (removed) {
                const embed = new EmbedBuilder()
                    .setTitle('🗑️ Temporary role removed')
                    .setColor(0xff9900)
                    .addFields(
                        { name: 'User', value: `<@${targetUser.id}>`, inline: true },
                        { name: 'Role', value: `<@&${targetRole.id}>`, inline: true },
                        { name: 'Removed by', value: `<@${member.id}>`, inline: true }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [embed] });
                
                // Powiadom użytkownika
                try {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('🗑️ Your role has been removed')
                        .setDescription(`Your role **${targetRole.name}** on server **${guild.name}** has been removed by an administrator.`)
                        .setColor(0xff0000)
                        .addFields(
                            { name: 'Removed by', value: member.user.tag, inline: true }
                        )
                        .setTimestamp();
                    
                    await targetUser.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    // Ignoruj błędy DM
                }
            } else {
                await interaction.reply({
                    content: '✅ Role removed, but it was not saved as temporary.',
                    flags: MessageFlags.Ephemeral
                });
            }
            
        } catch (error) {
            console.error('❌ Error:', error);
            await interaction.reply({
                content: `❌ Error: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }

    // 5. KOMENDA: /tempstats - statystyki (tylko admin)
    else if (commandName === 'tempstats') {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need administrator permissions!',
                flags: MessageFlags.Ephemeral
            });
        }
        
        const guildRoles = temporaryRoles.get(guild.id);
        let totalRoles = 0;
        let activeRoles = 0;
        let expiredSoon = 0;
        const now = Date.now();
        
        if (guildRoles) {
            for (const userRoles of guildRoles.values()) {
                totalRoles += userRoles.length;
                for (const roleData of userRoles) {
                    if (roleData.expiresAt > now) {
                        activeRoles++;
                        // Role wygasające w ciągu 24h
                        if (roleData.expiresAt - now < 24 * 60 * 60 * 1000) {
                            expiredSoon++;
                        }
                    }
                }
            }
        }
        
        const embed = new EmbedBuilder()
            .setTitle('📊 Temporary roles statistics')
            .setColor(0x0099ff)
            .addFields(
                { name: 'Total roles', value: totalRoles.toString(), inline: true },
                { name: 'Active roles', value: activeRoles.toString(), inline: true },
                { name: 'Expires in 24h', value: expiredSoon.toString(), inline: true },
                { name: 'Users with roles', value: guildRoles ? guildRoles.size.toString() : '0', inline: true }
            )
            .setFooter({ text: 'RAM System - data will be lost after bot restart' })
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    }
}

// ================================
// FUNKCJE DLA TICKETÓW
// ================================

// Tworzenie ticketu
async function handleCreateTicket(interaction, type) {
    const { user, guild } = interaction;
    
    // Sprawdź czy użytkownik ma już otwarty ticket
    const existingTicketId = userTicketCache.get(user.id);
    if (existingTicketId) {
        const existingChannel = guild.channels.cache.get(existingTicketId);
        if (existingChannel) {
            return interaction.editReply({
                content: `You have an opened ticket!: ${existingChannel}.`
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
                content: 'Error: Ticket category has not been found.'
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
            content: `Your ticket has been created: ${ticketChannel}`
        });

        console.log(`✅ Utworzono ticket ${type} dla ${user.tag}: ${ticketChannel.id}`);

    } catch (error) {
        console.error('❌ Błąd przy tworzeniu ticketu:', error);
        
        await interaction.editReply({
            content: 'An error has occured when trying to create your ticket, please contact with administration.'
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
                    console.log(`⚠️ Nie udało się wysłać DM do ${ticketUserId}`);
                });
            }
            
            // Usuń z cache
            userTicketCache.delete(ticketUserId);
        }

        // Usuń kanał
        await channel.delete('Ticket closed by admin');
        
        console.log(`✅ Zamknięto ticket: ${channel.name} przez ${member.user.tag}`);

    } catch (error) {
        console.error('❌ Błąd przy zamykaniu ticketu:', error);
        
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
                content: `An error has occured: ${error.message}`
            });
        } catch (replyError) {
            console.error('❌ Nie można wysłać odpowiedzi o błędzie:', replyError);
        }
    }
}

// ================================
// INICJALIZACJA PANELI TICKETÓW
// ================================

let panelsInitialized = false;

async function initializePanels() {
    if (panelsInitialized) return;
    panelsInitialized = true;
    
    console.log("🔄 Inicjalizacja paneli ticketów...");
    
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
        
        console.log("✅ Panele ticketów zainicjalizowane pomyślnie");
    } catch (error) {
        console.error('❌ Błąd przy inicjalizacji paneli:', error);
    }
}

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
        console.log(`ℹ️ Panel ${type} już istnieje w ${channel.name}`);
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

// ================================
// REJESTRACJA KOMEND SLASH
// ================================

async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('temprole')
            .setDescription('Give a user a temporary role')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User')
                    .setRequired(true))
            .addRoleOption(option =>
                option.setName('role')
                    .setDescription('Role to give')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('duration')
                    .setDescription('Duration in days (1-365)')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(365))
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for giving the role')
                    .setRequired(false)),
        
        new SlashCommandBuilder()
            .setName('myroles')
            .setDescription('Show your temporary roles'),
        
        new SlashCommandBuilder()
            .setName('roletime')
            .setDescription('Check remaining time for a role')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User (default: you)')
                    .setRequired(false))
            .addRoleOption(option =>
                option.setName('role')
                    .setDescription('Role')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('removetemp')
            .setDescription('Remove temporary role before time')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User')
                    .setRequired(true))
            .addRoleOption(option =>
                option.setName('role')
                    .setDescription('Role to remove')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('tempstats')
            .setDescription('Temporary roles statistics (admin only)')
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        console.log('🔄 Registering slash commands...');
        
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands.map(cmd => cmd.toJSON()) }
        );
        
        console.log('✅ Slash commands registered!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
}

// Uruchom inicjalizację paneli po ready
client.once('ready', async () => {
    // Małe opóźnienie, żeby bot się w pełni zainicjalizował
    setTimeout(() => {
        initializePanels();
    }, 3000);
});

// ================================
// OBSŁUGA ZAMYKANIA I BŁĘDÓW
// ================================

// Zatrzymaj timer przy zamykaniu
process.on('SIGINT', async () => {
    console.log('\n🔴 Closing bot...');
    clearInterval(roleCheckInterval);
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🔴 Closing bot...');
    clearInterval(roleCheckInterval);
    process.exit(0);
});

// Obsługa błędów
process.on('unhandledRejection', error => {
    console.error('❌ Unhandled Promise error:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Uncaught exception:', error);
});

// Login bota
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ Login error:', error);
    process.exit(1);
});