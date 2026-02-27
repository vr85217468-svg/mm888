// =========================================
// SUPABASE CONFIGURATION
// =========================================
const supabaseUrl = 'https://lrnvtovcdyeisnwzijar.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxybnZ0b3ZjZHllaXNud3ppamFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAzNTA0NDksImV4cCI6MjA1NTkyNjQ0OX0.sb_publishable_aeKPtRFfv3XKsn0ohsh5mw_q1HA1ZON';

// Initialize Supabase Client
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// =========================================
// DOM ELEMENTS
// =========================================
const messagesArea = document.getElementById('messagesArea');
const loadingSpinner = document.getElementById('loadingSpinner');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const currentUsernameEl = document.getElementById('currentUsername');

// Name Modal
const nameModal = document.getElementById('nameModal');
const nameInputModal = document.getElementById('nameInputModal');
const saveNameBtn = document.getElementById('saveNameBtn');
const editNameBtn = document.getElementById('editNameBtn');

// Image Modal & Input
const attachBtn = document.getElementById('attachBtn');
const imageInput = document.getElementById('imageInput');
const imagePreviewModal = document.getElementById('imagePreviewModal');
const previewImg = document.getElementById('previewImg');
const cancelImageBtn = document.getElementById('cancelImageBtn');
const confirmImageBtn = document.getElementById('confirmImageBtn');

// Toast
const toast = document.getElementById('toast');

// State
let currentUser = localStorage.getItem('chatUsername') || null;
let selectedImageFile = null;

// =========================================
// INITIALIZATION
// =========================================
async function init() {
    checkUser();
    await loadInitialMessages();
    subscribeToNewMessages();
    
    // Auto-resize textarea
    messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight < 100 ? this.scrollHeight : 100) + 'px';
    });
}

// =========================================
// USER MANAGEMENT
// =========================================
function checkUser() {
    if (!currentUser) {
        showNameModal();
    } else {
        currentUsernameEl.textContent = currentUser;
    }
}

function showNameModal() {
    nameModal.classList.add('active');
    nameInputModal.value = currentUser || '';
    nameInputModal.focus();
}

saveNameBtn.addEventListener('click', () => {
    const name = nameInputModal.value.trim();
    if (name.length > 0) {
        currentUser = name;
        localStorage.setItem('chatUsername', name);
        currentUsernameEl.textContent = name;
        nameModal.classList.remove('active');
        showToast(`مرحباً بك، \${name}!`);
    } else {
        showToast('الرجاء إدخال اسم صحيح');
    }
});

editNameBtn.addEventListener('click', showNameModal);

// =========================================
// MESSAGING LOGIC (SUPABASE)
// =========================================

// Load historical messages
async function loadInitialMessages() {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .order('created_at', { ascending: true })
            .limit(50); // Fetch last 50 messages

        if (error) throw error;

        // Clear spinner
        if (loadingSpinner) loadingSpinner.remove();
        
        // Render messages
        data.forEach(msg => renderMessage(msg));
        scrollToBottom();

    } catch (error) {
        console.error('Error loading messages:', error);
        loadingSpinner.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> خطأ في الاتصال بالخادم';
    }
}

// Listen to Real-time updates
function subscribeToNewMessages() {
    supabase
        .channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            const newMsg = payload.new;
            // Prevent duplicate rendering if we sent it
            // Simple check: we just render it. If we want optimistic UI we handle it differently.
            renderMessage(newMsg);
            scrollToBottom();
        })
        .subscribe();
}

// Send Text Message
async function sendMessage() {
    const content = messageInput.value.trim();
    if (!content) return;
    if (!currentUser) {
        showNameModal();
        return;
    }

    // Disable input while sending
    setSendingState(true);

    try {
        const { error } = await supabase
            .from('messages')
            .insert([{ 
                content: content, 
                sender_name: currentUser 
            }]);

        if (error) throw error;
        
        // Clear input
        messageInput.value = '';
        messageInput.style.height = 'auto';
        
    } catch (error) {
        console.error('Error sending:', error);
        showToast('فشل إرسال الرسالة!');
    } finally {
        setSendingState(false);
        messageInput.focus();
    }
}

// Send Image Message
async function sendImageMessage() {
    if (!selectedImageFile || !currentUser) return;

    // Show loading on button
    const originalBtnHTML = confirmImageBtn.innerHTML;
    confirmImageBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الرفع...';
    confirmImageBtn.disabled = true;

    try {
        // 1. Upload to Storage
        const fileExt = selectedImageFile.name.split('.').pop();
        const fileName = `\${Date.now()}-\${Math.random().toString(36).substring(7)}.\${fileExt}`;
        
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('chat_images')
            .upload(fileName, selectedImageFile);

        if (uploadError) throw uploadError;

        // 2. Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('chat_images')
            .getPublicUrl(fileName);

        // 3. Insert into Messages Table
        const { error: dbError } = await supabase
            .from('messages')
            .insert([{ 
                image_url: publicUrl, 
                sender_name: currentUser 
            }]);

        if (dbError) throw dbError;

        // Success cleanup
        closeImageModal();
        showToast('تم إرسال الصورة بنجاح');

    } catch (error) {
        console.error('Error sending image:', error);
        showToast('فشل إرسال الصورة!');
    } finally {
        confirmImageBtn.innerHTML = originalBtnHTML;
        confirmImageBtn.disabled = false;
    }
}

// =========================================
// UI HELPERS
// =========================================

function renderMessage(msg) {
    const isMe = msg.sender_name === currentUser;
    
    const div = document.createElement('div');
    div.className = `message \${isMe ? 'msg-me' : 'msg-other'}`;
    
    // Format Time
    const date = new Date(msg.created_at);
    const timeStr = date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });

    let html = '';
    
    // Sender Name (only if not me)
    if (!isMe) {
        html += `<div class="msg-sender">\${escapeHTML(msg.sender_name)}</div>`;
    }

    // Optional Image
    if (msg.image_url) {
        html += `<img src="\${msg.image_url}" class="msg-image" alt="Shared Image" loading="lazy" onclick="window.open('\${msg.image_url}', '_blank')">`;
    }

    // Content Text
    if (msg.content) {
        html += `<div class="msg-content">\${escapeHTML(msg.content)}</div>`;
    }

    // Timestamp
    html += `<span class="msg-time">\${timeStr}</span>`;

    div.innerHTML = html;
    messagesArea.appendChild(div);
}

function scrollToBottom() {
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function setSendingState(isSending) {
    sendBtn.disabled = isSending;
    messageInput.disabled = isSending;
    if (isSending) {
        sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    } else {
        sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
    }
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Prevent XSS
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag])
    );
}

// =========================================
// EVENT LISTENERS
// =========================================

// Sending Text
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Handling Images
attachBtn.addEventListener('click', () => {
    imageInput.click();
});

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        // Validate it's an image
        if (!file.type.startsWith('image/')) {
            showToast('الرجاء اختيار صورة فقط');
            return;
        }
        
        // Show Preview Modal
        selectedImageFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            imagePreviewModal.classList.add('active');
        };
        reader.readAsDataURL(file);
    }
    // clear input
    imageInput.value = '';
});

function closeImageModal() {
    imagePreviewModal.classList.remove('active');
    selectedImageFile = null;
    previewImg.src = '';
}

cancelImageBtn.addEventListener('click', closeImageModal);
confirmImageBtn.addEventListener('click', sendImageMessage);

// Boot up
window.addEventListener('DOMContentLoaded', init);
