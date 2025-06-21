// Global variables
let backgroundType = "office";
let blurIntensity = 10; // Default to a visible blur
let isVideoEnabled = true;
let isMicEnabled = true;
let isGestureEnabled = true;
let videoStream = null;
let audioStream = null;
let recognition = null;
let bodyPixNet = null;
let hands = null;
let camera = null;
let lastGesture = null; // Track last gesture for one-time effect
let peaceActive = false; // For peace gesture one-time effect
let micPermissionRequested = false; // For transcription mic permission
let transcriptionInitialized = false; // For transcription setup

// Canvas contexts
let mainCanvas, mainCtx;
let offscreenCanvas, offscreenCtx;

const backgroundImages = {
    office: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=600&fit=crop",
    nature: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop"
};

// Optimized blur function using separable Gaussian blur
class OptimizedBlur {
    constructor() {
        this.blurCanvas = document.createElement('canvas');
        this.blurCtx = this.blurCanvas.getContext('2d');
    }

    gaussianBlur(imageData, radius) {
        const { data, width, height } = imageData;
        const blurData = new Uint8ClampedArray(data);
        
        // Create Gaussian kernel
        const kernel = this.createGaussianKernel(radius);
        const kernelSize = kernel.length;
        const half = Math.floor(kernelSize / 2);

        // Horizontal pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0, g = 0, b = 0, a = 0;
                
                for (let i = 0; i < kernelSize; i++) {
                    const px = Math.min(Math.max(x + i - half, 0), width - 1);
                    const idx = (y * width + px) * 4;
                    const weight = kernel[i];
                    
                    r += data[idx] * weight;
                    g += data[idx + 1] * weight;
                    b += data[idx + 2] * weight;
                    a += data[idx + 3] * weight;
                }
                
                const idx = (y * width + x) * 4;
                blurData[idx] = r;
                blurData[idx + 1] = g;
                blurData[idx + 2] = b;
                blurData[idx + 3] = a;
            }
        }

        // Vertical pass
        const finalData = new Uint8ClampedArray(blurData);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                let r = 0, g = 0, b = 0, a = 0;
                
                for (let i = 0; i < kernelSize; i++) {
                    const py = Math.min(Math.max(y + i - half, 0), height - 1);
                    const idx = (py * width + x) * 4;
                    const weight = kernel[i];
                    
                    r += blurData[idx] * weight;
                    g += blurData[idx + 1] * weight;
                    b += blurData[idx + 2] * weight;
                    a += blurData[idx + 3] * weight;
                }
                
                const idx = (y * width + x) * 4;
                finalData[idx] = r;
                finalData[idx + 1] = g;
                finalData[idx + 2] = b;
                finalData[idx + 3] = a;
            }
        }

        return new ImageData(finalData, width, height);
    }

    createGaussianKernel(radius) {
        const size = 2 * Math.ceil(radius) + 1;
        const kernel = new Float32Array(size);
        const sigma = radius / 3;
        const twoSigmaSquared = 2 * sigma * sigma;
        const center = Math.floor(size / 2);
        
        let sum = 0;
        for (let i = 0; i < size; i++) {
            const distance = i - center;
            const value = Math.exp(-distance * distance / twoSigmaSquared);
            kernel[i] = value;
            sum += value;
        }
        
        // Normalize
        for (let i = 0; i < size; i++) {
            kernel[i] /= sum;
        }
        
        return kernel;
    }
}

const optimizedBlur = new OptimizedBlur();

// Webcam setup
async function setupWebcam(video) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: false
        });
        videoStream = stream;
        video.srcObject = stream;
        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                resolve(video);
            };
        });
    } catch (error) {
        console.error("Error accessing webcam:", error);
        alert("Unable to access webcam. Please check permissions.");
        throw error;
    }
}

// Microphone setup (request only when needed)
async function setupMicrophone() {
    if (audioStream) return audioStream;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioStream = stream;
        // Attach audio tracks to videoStream if not present
        if (videoStream) {
            stream.getAudioTracks().forEach(track => videoStream.addTrack(track));
        }
        return stream;
    } catch (error) {
        console.error("Error accessing microphone:", error);
        alert("Unable to access microphone. Please check permissions.");
        throw error;
    }
}

// Load background images
async function loadBackgroundImages() {
    const loadedImages = {};
    for (const [key, url] of Object.entries(backgroundImages)) {
        loadedImages[key] = await loadImage(url);
    }
    return loadedImages;
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

// Background processing setup
async function setupBackground(video, canvas) {
    bodyPixNet = await bodyPix.load({
        architecture: 'MobileNetV1',
        outputStride: 16,
        multiplier: 0.75,
        quantBytes: 2
    });

    mainCanvas = canvas;
    mainCtx = canvas.getContext("2d");
    
    // Create offscreen canvas for processing
    offscreenCanvas = document.createElement('canvas');
    offscreenCtx = offscreenCanvas.getContext('2d');
    
    const loadedBgImages = await loadBackgroundImages();
    let animationFrame;

    async function processFrame() {
        if (!isVideoEnabled) {
            mainCtx.clearRect(0, 0, canvas.width, canvas.height);
            mainCtx.fillStyle = '#000000';
            mainCtx.fillRect(0, 0, canvas.width, canvas.height);
            animationFrame = requestAnimationFrame(processFrame);
            return;
        }

        try {
            if (backgroundType === "none") {
                mainCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
            } else {
                const segmentation = await bodyPixNet.segmentPerson(video, {
                    flipHorizontal: false,
                    internalResolution: 'medium',
                    segmentationThreshold: 0.7
                });

                await applyBackgroundEffect(video, canvas, segmentation, loadedBgImages);
            }
        } catch (error) {
            console.error("Error in frame processing:", error);
        }

        animationFrame = requestAnimationFrame(processFrame);
    }

    processFrame();

    return () => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
        }
    };
}

// Apply background effects
async function applyBackgroundEffect(video, canvas, segmentation, bgImages) {
    const mask = segmentation.data;
    
    // Set offscreen canvas size
    offscreenCanvas.width = canvas.width;
    offscreenCanvas.height = canvas.height;
    
    // Draw video frame
    mainCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = mainCtx.getImageData(0, 0, canvas.width, canvas.height);
    
    let backgroundFrame;
    
    if (backgroundType === "blur") {
        // Apply optimized blur to the entire frame (use blurIntensity directly)
        const blurredFrame = optimizedBlur.gaussianBlur(frame, blurIntensity);
        backgroundFrame = blurredFrame;
    } else if (bgImages[backgroundType]) {
        // Draw background image
        offscreenCtx.drawImage(bgImages[backgroundType], 0, 0, canvas.width, canvas.height);
        backgroundFrame = offscreenCtx.getImageData(0, 0, canvas.width, canvas.height);
    }
    
    // Combine person with background
    const resultData = new Uint8ClampedArray(frame.data);
    
    for (let i = 0; i < mask.length; i++) {
        const pixelIndex = i * 4;
        if (mask[i] === 0 && backgroundFrame) { // Background pixel
            resultData[pixelIndex] = backgroundFrame.data[pixelIndex];
            resultData[pixelIndex + 1] = backgroundFrame.data[pixelIndex + 1];
            resultData[pixelIndex + 2] = backgroundFrame.data[pixelIndex + 2];
            resultData[pixelIndex + 3] = backgroundFrame.data[pixelIndex + 3];
        }
    }
    
    const resultImage = new ImageData(resultData, canvas.width, canvas.height);
    mainCtx.putImageData(resultImage, 0, 0);
}

// Gesture recognition setup
function setupGestureRecognition(video) {
    hands = new Hands({
        locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5,
    });

    hands.onResults(onGestureResults);

    camera = new Camera(video, {
        onFrame: async () => {
            if (isGestureEnabled) {
                // Prevent WASM abort if video is not ready
                if (video.videoWidth === 0 || video.videoHeight === 0) {
                    console.warn('Video has zero size when sending to Hands!');
                    return;
                }
                await hands.send({ image: video });
            }
        },
        width: 640,
        height: 480,
    });
}

function onGestureResults(results) {
    if (!isGestureEnabled) return;
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        detectGesture(landmarks);
    } else {
        updateGestureIndicator("");
    }
}

// Gesture detection functions
function calculateDistance(point1, point2) {
    return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
}

function isFingerExtended(landmarks, fingerTip, fingerPip, fingerMcp) {
    const tipToPip = calculateDistance(landmarks[fingerTip], landmarks[fingerPip]);
    const pipToMcp = calculateDistance(landmarks[fingerPip], landmarks[fingerMcp]);
    const tipToMcp = calculateDistance(landmarks[fingerTip], landmarks[fingerMcp]);
    return tipToMcp > (tipToPip + pipToMcp) * 0.85;
}

function isThumbExtended(landmarks) {
    const thumbTip = landmarks[4];
    const palmCenter = {
        x: (landmarks[0].x + landmarks[5].x + landmarks[17].x) / 3,
        y: (landmarks[0].y + landmarks[5].y + landmarks[17].y) / 3
    };
    const thumbDistance = calculateDistance(thumbTip, palmCenter);
    return thumbDistance > 0.08;
}

function isThumbsUp(landmarks) {
    if (!landmarks || landmarks.length < 21) return false;
    const thumb = landmarks[4];
    const thumbIp = landmarks[3];
    const thumbUp = thumb.y < thumbIp.y - 0.03;
    const thumbExtended = isThumbExtended(landmarks);
    const fingersFolded = 
        !isFingerExtended(landmarks, 8, 6, 5) &&
        !isFingerExtended(landmarks, 12, 10, 9) &&
        !isFingerExtended(landmarks, 16, 14, 13) &&
        !isFingerExtended(landmarks, 20, 18, 17);
    return thumbUp && thumbExtended && fingersFolded;
}

function isThumbsDown(landmarks) {
    if (!landmarks || landmarks.length < 21) return false;
    const thumb = landmarks[4];
    const thumbIp = landmarks[3];
    const thumbDown = thumb.y > thumbIp.y + 0.03;
    const thumbExtended = isThumbExtended(landmarks);
    const fingersFolded = 
        !isFingerExtended(landmarks, 8, 6, 5) &&
        !isFingerExtended(landmarks, 12, 10, 9) &&
        !isFingerExtended(landmarks, 16, 14, 13) &&
        !isFingerExtended(landmarks, 20, 18, 17);
    return thumbDown && thumbExtended && fingersFolded;
}

function isPeaceSign(landmarks) {
    if (!landmarks || landmarks.length < 21) return false;
    const indexExtended = isFingerExtended(landmarks, 8, 6, 5);
    const middleExtended = isFingerExtended(landmarks, 12, 10, 9);
    const ringFolded = !isFingerExtended(landmarks, 16, 14, 13);
    const pinkyFolded = !isFingerExtended(landmarks, 20, 18, 17);
    const thumbNeutral = !isThumbExtended(landmarks);
    const fingerSeparation = calculateDistance(landmarks[8], landmarks[12]);
    return indexExtended && middleExtended && ringFolded && pinkyFolded && 
           thumbNeutral && fingerSeparation > 0.04;
}

function isOpenHand(landmarks) {
    if (!landmarks || landmarks.length < 21) return false;
    return isThumbExtended(landmarks) && 
           isFingerExtended(landmarks, 8, 6, 5) &&
           isFingerExtended(landmarks, 12, 10, 9) &&
           isFingerExtended(landmarks, 16, 14, 13) &&
           isFingerExtended(landmarks, 20, 18, 17);
}

function detectGesture(landmarks) {
    let gesture = null;
    if (isThumbsUp(landmarks)) {
        gesture = 'like';
    } else if (isThumbsDown(landmarks)) {
        gesture = 'dislike';
    } else if (isPeaceSign(landmarks)) {
        gesture = 'peace';
    } else if (isOpenHand(landmarks)) {
        gesture = 'raised';
    }
    if (gesture) {
        if (gesture === 'peace') {
            // Only trigger peace gesture once per continuous sign
            if (!peaceActive) {
                peaceActive = true;
                lastGesture = 'peace';
                updateGestureIndicator("✌️ Peace Sign");
                triggerEffect('peace');
            }
        } else if (lastGesture !== gesture) {
            peaceActive = false;
            lastGesture = gesture;
            const gestureText = {
                like: "👍 Thumbs Up",
                dislike: "👎 Thumbs Down",
                raised: "✋ Open Hand"
            };
            updateGestureIndicator(gestureText[gesture]);
            triggerEffect(gesture);
        }
    } else {
        if (lastGesture !== null || peaceActive) {
            lastGesture = null;
            peaceActive = false;
            updateGestureIndicator("No gesture detected");
        }
    }
}

function updateGestureIndicator(text) {
    const indicator = document.getElementById('gesture-indicator');
    if (indicator) {
        indicator.textContent = text;
    }
}

function triggerEffect(gestureName) {
    const gestures = {
        raised: { text: "✋ Hand Raised!", color: "#28a745" },
        like: { text: "👍 Like!", color: "#007bff" },
        dislike: { text: "👎 Dislike!", color: "#dc3545" },
        peace: { text: "✌️ Peace!", color: "#fd7e14" }
    };

    const gesture = gestures[gestureName];
    if (!gesture) return;

    const msg = document.createElement('div');
    msg.textContent = gesture.text;
    msg.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 48px;
        color: ${gesture.color};
        background: white;
        padding: 30px;
        border: 3px solid ${gesture.color};
        border-radius: 20px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        z-index: 1001;
        animation: fadeInOut 2s ease-in-out;
    `;

    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
            50% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
            100% { opacity: 0; transform: translate(-50%, -50%) scale(1); }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(msg);

    setTimeout(() => {
        msg.remove();
        style.remove();
    }, 2000);
}

// Speech recognition setup
async function setupTranscription() {
    if (transcriptionInitialized) return; // Only initialize once
    transcriptionInitialized = true;
    const transcriptionDiv = document.getElementById("transcription");
    if (!('webkitSpeechRecognition' in window)) {
        transcriptionDiv.innerHTML = "<strong>Live Transcription:</strong><br>Speech recognition not supported in this browser";
        return;
    }

    // Ensure mic permission is granted only once
    if (!micPermissionRequested) {
        micPermissionRequested = true;
        try {
            if (!audioStream) {
                await setupMicrophone();
            }
        } catch (err) {
            transcriptionDiv.innerHTML = "<strong>Live Transcription:</strong><br>Microphone permission denied.";
            return;
        }
    }

    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript + ' ';
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        transcriptionDiv.innerHTML = '<strong>Live Transcription:</strong><br>' + 
            finalTranscript + '<i style="color: #999">' + interimTranscript + '</i>';
    };

    recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        transcriptionDiv.innerHTML = "<strong>Live Transcription:</strong><br>Error: " + event.error;
    };

    recognition.onend = () => {
        if (isMicEnabled) {
            recognition.start();
        }
    };

    if (isMicEnabled) {
        recognition.start();
    }

    return recognition;
}

// Initialize everything
async function initialize() {
    const video = document.getElementById("large-video");
    const canvas = document.getElementById("canvas");
    const loadingDiv = document.getElementById("loading");

    try {
        await setupWebcam(video);

        if (video.videoWidth === 0 || video.videoHeight === 0) {
            await new Promise(resolve => {
                video.onloadeddata = resolve;
            });
        }

        
        // Set canvas size to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Setup background processing
        const cleanup = await setupBackground(video, canvas);
        
        // Setup gesture recognition
        setupGestureRecognition(video);
        if (camera) {
            camera.start();
        }
        
        // Setup transcription
        await setupTranscription();
        
        loadingDiv.style.display = "none";
        setupEventListeners();

    } catch (error) {
        loadingDiv.innerHTML = "Error initializing: " + error.message;
        console.error("Initialization error:", error);
    }
}

// Event listeners
function setupEventListeners() {
    document.getElementById("background-select").addEventListener("change", (e) => {
        backgroundType = e.target.value;
    });

    document.getElementById("blur-intensity").addEventListener("change", (e) => {
        blurIntensity = parseInt(e.target.value);
    });

    document.getElementById("camera-toggle").addEventListener("click", () => {
        isVideoEnabled = !isVideoEnabled;
        if (videoStream) {
            const tracks = videoStream.getVideoTracks();
            tracks.forEach(track => track.enabled = isVideoEnabled);
        }
        const btn = document.getElementById("camera-toggle");
        btn.textContent = isVideoEnabled ? "📹 Turn Off Camera" : "📹 Turn On Camera";
        btn.classList.toggle("disabled", !isVideoEnabled);
    });

    document.getElementById("mic-toggle").addEventListener("click", async () => {
        isMicEnabled = !isMicEnabled;
        if (isMicEnabled) {
            await setupMicrophone();
        }
        if (videoStream) {
            const tracks = videoStream.getAudioTracks();
            tracks.forEach(track => track.enabled = isMicEnabled);
        }
        if (recognition) {
            if (isMicEnabled) {
                recognition.start();
            } else {
                recognition.stop();
            }
        }
        const btn = document.getElementById("mic-toggle");
        btn.textContent = isMicEnabled ? "🎤 Turn Off Mic" : "🎤 Turn On Mic";
        btn.classList.toggle("disabled", !isMicEnabled);
    });

    document.getElementById("gesture-toggle").addEventListener("click", () => {
        isGestureEnabled = !isGestureEnabled;
        const btn = document.getElementById("gesture-toggle");
        btn.textContent = isGestureEnabled ? "👋 Turn Off Gestures" : "👋 Turn On Gestures";
        btn.classList.toggle("disabled", !isGestureEnabled);
        if (!isGestureEnabled) {
            updateGestureIndicator("Gesture recognition disabled");
        } else {
            updateGestureIndicator("");
        }
    });
}

// Start the application
if(document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
}