require("dotenv").config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ChannelType, PermissionFlagsBits, EmbedBuilder } = require("discord.js");




const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});



// Logowanie bota przy użyciu tokena z ENV
client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("Bot zalogowany!"))
  .catch(err => console.error("Błąd logowania:", err));

// Opcjonalnie: sprawdzenie, czy Render widzi token
console.log("DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? "OK" : "BRAK");

// Przykładowy event: bot reaguje po zalogowaniu
client.on('ready', () => {
  console.log(`Zalogowano jako ${client.user.tag}`);
});








































client.on('guildMemberAdd', member => {
    console.log("Dołączył:", member.user.tag); 
    const channelId = '1467588026086719739';
    const channel = member.guild.channels.cache.get(channelId);
    if (!channel) return;

    const welcomeEmbed = new EmbedBuilder()
        .setTitle(`👋 Welcome to ZETAS server!`)
        .setDescription(`Hi ${member.user}, it's nice to see you on our server!`)
        .setColor(0x00ff00)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: 'ZETAS Community' });

    channel.send({ embeds: [welcomeEmbed] });
});


client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const guild = interaction.guild;
    const user = interaction.user;

    let ticketCategoryId;
    let ticketTitle;
    let ticketDescription;


    if (interaction.customId === 'create_ticket') {
        ticketCategoryId = '1467935963018825941'; 
        ticketTitle = `${user.username}'s Application Ticket`;
        ticketDescription = `Please read the requirements in <#1467923593513144320> and answer the questions in this ticket:\n\n1.\n2.\n3.`;
    } else if (interaction.customId === 'create_ticket_help') {
        ticketCategoryId = '1467973590791094436'; 
        ticketTitle = `${user.username}'s Help Ticket`;
        ticketDescription = `Welcome to the help ticket! Please describe your issue in detail and our support team will assist you shortly.`;
    } else if (interaction.customId === 'close_ticket') {
        // --- Zamknięcie ticketa ---
        const member = interaction.member;
        if (!member.roles.cache.has('1467935721707802675')) {
            return interaction.reply({ content: "❌ Only Administration can close tickets!", ephemeral: true });
        }

        const ticketUserId = interaction.channel.topic;
        if (ticketUserId) {
            const ticketUser = await client.users.fetch(ticketUserId).catch(() => null);
            if (ticketUser) {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('Your ticket has been closed!')
                    .setDescription(`${member.user.tag} closed your ticket`)
                    .setColor(0xff0000)
                    .setTimestamp()
                    .setFooter({ text: 'Support ZETAS' });

                ticketUser.send({ embeds: [dmEmbed] }).catch(() => {
                    console.log(`Nie udało się wysłać DM do ${ticketUserId}`);
                });
            }
        }

        await interaction.channel.delete();
        return;
    } else {
        return; 
    }

  
    const existingChannel = guild.channels.cache.find(
        c => c.name === `ticket-${user.username.toLowerCase()}` && c.parentId === ticketCategoryId
    );
    if (existingChannel) 
        return interaction.reply({ content: 'You have already opened a ticket', ephemeral: true });


    const ticketChannel = await guild.channels.create({
        name: `ticket-${user.username}`,
        type: ChannelType.GuildText,
        parent: ticketCategoryId,
        topic: user.id,
        permissionOverwrites: [
            { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: '1467935721707802675', allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] } 
        ],
    });

  
    const closeButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
    );

    const adminRoleId = '1467935721707802675';
    const creatorMention = `<@${user.id}>`;
    const adminMention = `<@&${adminRoleId}>`;

    const ticketEmbed = new EmbedBuilder()
        .setTitle(ticketTitle)
        .setDescription(ticketDescription)
        .setColor(0x0099ff)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: 'Support ZETAS', iconURL: client.user.displayAvatarURL() });

    await ticketChannel.send({
        content: `${creatorMention} ${adminMention}`,
        embeds: [ticketEmbed],
        components: [closeButton]
    });

    return interaction.reply({ content: `Your ticket has been created in: ${ticketChannel}`, ephemeral: true });
});


client.once('ready', async () => {
    console.log("Bot działa:", client.user.tag);

 
    const channel1 = await client.channels.fetch('1467923669186510951');
    const embed1 = new EmbedBuilder()
        .setTitle('Want to join ZETAS?')
        .setDescription('Click the button below to create a new ticket and contact the administration!')
        .setColor(0x0099ff)
        .setThumbnail('https://cdn.discordapp.com/attachments/1467943172306112534/1467949329817014312/0b6381438e644bf194f5a334fa8923d0tplv-jj85edgx6n-image-medium.jpeg')
        .setImage('https://cdn.discordapp.com/attachments/1467943172306112534/1467949329817014312/0b6381438e644bf194f5a334fa8923d0tplv-jj85edgx6n-image-medium.jpeg')
        .setTimestamp()
        .setFooter({ text: 'ZETAS Support', iconURL: client.user.displayAvatarURL() });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('create_ticket')
            .setLabel('Create ticket')
            .setStyle(ButtonStyle.Primary)
    );

    await channel1.send({ embeds: [embed1], components: [row1] });

 
    const channel2 = await client.channels.fetch('1467590287990718655');
    const embed2 = new EmbedBuilder()
        .setTitle('Do you need help?')
        .setDescription('Click the button below to get help!')
        .setColor(0x0099ff)
        .setThumbnail('https://cdn.discordapp.com/attachments/1467943172306112534/1467949329817014312/0b6381438e644bf194f5a334fa8923d0tplv-jj85edgx6n-image-medium.jpeg')
        .setTimestamp()
        .setFooter({ text: 'ZETAS Support', iconURL: client.user.displayAvatarURL() });

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('create_ticket_help')
            .setLabel('Create ticket')
            .setStyle(ButtonStyle.Primary)
    );

    await channel2.send({ embeds: [embed2], components: [row2] });
});


client.login(process.env.DISCORD_TOKEN);
