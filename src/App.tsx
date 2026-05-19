import React, { useState, useEffect } from 'react';
import { 
  Camera, 
  Sparkles, 
  History as HistoryIcon, 
  Settings, 
  Maximize2, 
  Layout, 
  ChevronRight,
  Download,
  Trash2,
  Plus,
  X,
  Loader2,
  Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
type Resolution = '1k' | '2k' | '4k';
type AspectRatio = '1:1' | '3:4' | '4:3' | '16:9';
type GenerationMode = 'analysis' | 'style';

interface HistoryItem {
  id: string;
  url: string;
  timestamp: number;
  mode: GenerationMode;
  prompt: string;
}

// --- Utils ---
const compressImage = async (base64: string, maxWidth = 1024, maxHeight = 1024, quality = 0.8): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Failed to get canvas context'));

      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = (err) => reject(err);
  });
};

// --- Components ---

const ImageUploader = ({ 
  label, 
  onUpload, 
  preview 
}: { 
  label: string; 
  onUpload: (base64: string) => void; 
  preview?: string 
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onUpload(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</span>
      <label className="relative flex aspect-video w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 transition-all hover:border-neutral-400 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900">
        {preview ? (
          <img src={preview} alt="Preview" className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-neutral-400">
            <ImageIcon size={32} />
            <span className="text-sm">Click or drag to upload</span>
          </div>
        )}
        <input type="file" className="hidden" onChange={handleChange} accept="image/*" />
      </label>
    </div>
  );
};

export default function App() {
  const [mode, setMode] = useState<GenerationMode>('analysis');
  const [resolution, setResolution] = useState<Resolution>('1k');
  const [ratio, setRatio] = useState<AspectRatio>('1:1');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  // Logic 1 State
  const [refImage, setRefImage] = useState<string>('');
  const [productImage, setProductImage] = useState<string>('');
  const [objects, setObjects] = useState<string[]>([]);
  const [mainSubject, setMainSubject] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [newObject, setNewObject] = useState('');

  // Logic 2 State
  const [selectedStyle, setSelectedStyle] = useState('Cinematic Noir Glamour');
  const [styleObjects, setStyleObjects] = useState<string[]>([]);
  const [styleNewObject, setStyleNewObject] = useState('');
  const beautyStyles = [
    { name: 'Cinematic Noir Glamour', prompt: "Professional high-fashion beauty photography series. Model: a stunning young woman (~20s) with dark hair and dynamic, messy wisps framing her face. Features: thick natural arched brows, captivating light green eyes with earth-toned makeup, and long, dramatically curled lashes. Full glossy lips in a coral-orange hue, and radiant warm beige-tan skin (hex #efc4a5) with ultra-refined dewy finish. Lighting: Intense cinematic chiaroscuro with dramatic horizontal slat shadows (blinds effect) and warm golden highlights casting across the face. Composition: Extreme close-up; model gracefully holding the product near her face with a confident, seductive gaze. High-end luxury commercial aesthetic." },
    { name: 'Pure Luminous Glow', prompt: "Extreme close-up beauty portrait, head and shoulders tightly cropped (face 60-70% of frame). Model: Young woman with short, fluffy natural black curly hair. Features: Radiant warm beige-tan skin (hex #efc4a5) with honey-golden luminous glow, smooth hydrated 'glass skin' texture. Actions: Model naturally holds the cosmetic product near her cheek or chin, intimate interaction. Lighting: 85mm lens perspective, soft diffused front lighting, luminous wet-look skin, glossy lips. Background: Clean warm beige or cream gradient. Professional beauty editorial aesthetic, youthful and approachable mood." }
  ];

  const [generating, setGenerating] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // SaaS Integration State
  const [saasConfig, setSaasConfig] = useState<{ userId: string; toolId: string } | null>(null);
  const [userData, setUserData] = useState<{ name: string; integral: number } | null>(null);
  const [toolData, setToolData] = useState<{ name: string; integral: number } | null>(null);

  // --- Initialization ---
  useEffect(() => {
    // 1. Listen for postMessage from SaaS
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SAAS_INIT') {
        const { userId, toolId } = event.data;
        if (userId && toolId) {
          setSaasConfig({ userId, toolId });
          initToolLaunch(userId, toolId);
        }
      }
    };

    // 2. Check URL params as fallback
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const toolId = params.get('toolId');
    if (userId && toolId) {
      setSaasConfig({ userId, toolId });
      initToolLaunch(userId, toolId);
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const initToolLaunch = async (userId: string, toolId: string) => {
    try {
      const res = await fetch('/api/tool/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, toolId })
      });
      const text = await res.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(text || 'Launch API returned non-JSON response');
      }
      if (res.ok && result.success) {
        setUserData(result.data.user);
        setToolData(result.data.tool);
      }
    } catch (err) {
      console.error("Tool launch failed:", err);
    }
  };

  // --- Handlers ---
  const handleAnalyze = async () => {
    if (!refImage) return;
    setAnalyzing(true);
    try {
      const compressedRef = await compressImage(refImage, 768, 768, 0.68);
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: compressedRef })
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || 'Analyze API returned non-JSON response');
      }
      if (!res.ok) {
        const detailMessage = data.detail || data.error || data.message || text;
        throw new Error(detailMessage || 'Analyze failed');
      }
      if (data.mainSubject) setMainSubject(data.mainSubject);
      if (data.environment) setObjects(data.environment);
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      let prompt = '';
      if (mode === 'analysis') {
        prompt = `Professional e-commerce beauty product replacement task.
        REFERENCE SCENE: A scene containing ${objects.join(', ')} and a ${mainSubject}.
        TARGET PRODUCT: The product in the second uploaded product image.
        
        GOAL: Replace the ${mainSubject} in the reference scene with the TARGET PRODUCT.
        
        CORE INSTRUCTIONS:
        1. Natural Interaction: If there is a model, keep their identity and expression identical, but adjust the hand position or finger grip slightly to hold the TARGET PRODUCT naturally.
        2. Product Fidelity: The TARGET PRODUCT must be rendered with extreme high fidelity, maintaining its original shape, labeling, text, and proportions exactly as shown in the product image. Avoid any distortion or 'hallucination' of the product's branding.
        3. Lighting & Atmosphere: The generated image MUST strictly match the lighting direction, highlights, shadow depth, color temperature, and atmospheric mood of the REFERENCE SCENE. The TARGET PRODUCT must appear as if it was captured in the exact same lighting setup as the original scene, inheriting all environmental reflections, highlights, and cast shadows.
        4. Seamless Integration: Ensure the contact points between the product and environment (or hands) look realistic with natural contact shadows and physically accurate depth.
        5. Consistency: Maintain the exact aesthetic, background, color palette, and other objects from the REFERENCE SCENE: ${objects.join(', ')}.
        6. Quality: High-end commercial cosmetic photography, professional studio retouching.`;
      } else {
        const style = beautyStyles.find(s => s.name === selectedStyle);
        prompt = style?.prompt || selectedStyle;
        if (styleObjects.length > 0) {
          prompt += ` Extra scene elements to include: ${styleObjects.join(', ')}.`;
        }
        if (productImage) {
          prompt += " IMPORTANT: The generated image MUST feature the model naturally holding the product from the uploaded product image. Ensure the hand position, grip, and finger placement are realistic. The product MUST maintain absolute fidelity to its original design, labels, and shape. It must perfectly inherit the scene's lighting, highlights, and cast soft contact shadows on the model's skin and environment.";
        }
      }

      // Determine number of images to generate
      const count = mode === 'analysis' ? 1 : 1; // Temporarily 1 for both for stability
      const newItems: HistoryItem[] = [];

      // Pre-compress images once
      const compressedProd = productImage ? await compressImage(productImage, 768, 768, 0.68) : undefined;
      const compressedRef = (mode === 'analysis' && refImage) ? await compressImage(refImage, 768, 768, 0.68) : undefined;

      for (let i = 0; i < count; i++) {
        try {
          // Adjust imageSize for backend - 4k is too heavy for current limits, use 2K
          const requestedImageSize = resolution === '4k' ? '2K' : resolution.toUpperCase();

          const res = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              prompt: prompt + (count > 1 ? ` Variation ${i + 1}-${Math.random().toString(36).substring(7)}` : ''), 
              config: { aspectRatio: ratio, imageSize: requestedImageSize },
              productImage: compressedProd,
              referenceImage: compressedRef,
              userId: saasConfig?.userId,
              toolId: saasConfig?.toolId
            })
          });

          if (!res.ok) {
            const errorText = await res.text();
            let errorMessage = errorText;

            // Handle 504 Gateway Timeout specifically
            if (res.status === 504 || errorText.toLowerCase().includes('gateway time-out')) {
               errorMessage = "生成超时，请切换 1K/2K 或稍后重试。";
            } else {
              try {
                const errorJson = JSON.parse(errorText);
                errorMessage =
                  errorJson.detail ||
                  errorJson.error ||
                  errorJson.message ||
                  errorText;
              } catch {}
            }

            console.error(`Generation failed for image ${i + 1}:`, errorText);
            alert(errorMessage);
            continue;
          }

          const text = await res.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            console.error(`Non-JSON response for image ${i + 1}:`, text);
            continue;
          }
          if (data.imageUrl) {
            const newItem = {
              id: (Date.now() + i).toString(),
              url: data.imageUrl,
              timestamp: Date.now(),
              mode,
              prompt: prompt.substring(0, 100) + '...'
            };
            newItems.push(newItem);
            
            // Asynchronously save to SaaS if configured
            if (saasConfig?.userId && saasConfig?.toolId) {
              saveToSaaS(data.imageUrl, saasConfig.userId, saasConfig.toolId);
            }
          }
        } catch (err) {
          console.error(`Error generating image ${i + 1}:`, err);
        }
      }

      if (newItems.length > 0) {
        setHistory([...newItems, ...history]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  const saveToSaaS = async (imageUrl: string, userId: string, toolId: string) => {
    try {
      const res = await fetch('/api/save-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, userId, toolId })
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn('Asynchronous SaaS save failed:', text);
      }
    } catch (err) {
      console.warn('Asynchronous SaaS save error:', err);
    }
  };

  const deleteHistory = (id: string) => {
    setHistory(history.filter(h => h.id !== id));
  };

  const downloadImage = (url: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `beauty-gen-${Date.now()}.png`;
    link.click();
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white text-neutral-900 dark:bg-black dark:text-neutral-100">
      {/* Sidebar */}
      <aside className="flex w-80 flex-col overflow-y-auto border-r border-neutral-100 bg-neutral-50 p-6 dark:border-neutral-900 dark:bg-black/50">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
            <Sparkles size={20} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">BeautyGen AI</h1>
        </div>

        <nav className="flex flex-col gap-2">
          <span className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Navigation</span>
          <button 
            onClick={() => setMode('analysis')}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${mode === 'analysis' ? 'bg-white shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
          >
            <Camera size={18} />
            Analysis & Replace
          </button>
          <button 
            onClick={() => setMode('style')}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${mode === 'style' ? 'bg-white shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
          >
            <Layout size={18} />
            Style Direct Gen
          </button>
        </nav>

        <div className="mt-10 flex flex-col gap-6">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Settings</span>
          
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-400">
              <Settings size={14} />
              Resolution
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['1k', '2k', '4k'] as Resolution[]).map(r => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  className={`rounded-lg py-2 text-xs font-bold uppercase ${resolution === r ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-400">
              <Maximize2 size={14} />
              Aspect Ratio
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['1:1', '3:4', '4:3', '16:9'] as AspectRatio[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRatio(r)}
                  className={`rounded-lg py-2 text-xs font-bold ${ratio === r ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 overflow-hidden">
            <label className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-400">
              <HistoryIcon size={14} />
              History
            </label>
            <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1 scrollbar-hide">
              {history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedImage(item.url)}
                  className="relative aspect-square overflow-hidden rounded-lg bg-neutral-200 transition-transform active:scale-95 dark:bg-neutral-800"
                >
                  <img src={item.url} alt="History thumbnail" className="h-full w-full object-cover" />
                </button>
              ))}
              {history.length === 0 && (
                <div className="col-span-3 flex aspect-[3/1] items-center justify-center rounded-lg border border-dashed border-neutral-300 text-[10px] text-neutral-400 dark:border-neutral-700">
                  Empty
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-auto pt-6 border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2 rounded-xl bg-neutral-900/5 p-3 dark:bg-white/5">
             <div className="h-8 w-8 rounded-full bg-neutral-200 flex items-center justify-center font-bold text-neutral-500 dark:bg-neutral-800">
                {userData?.name?.[0] || 'U'}
             </div>
             <div className="flex flex-col">
                <span className="text-xs font-bold truncate max-w-[120px]">{userData?.name || 'Standard Account'}</span>
                <span className="text-[10px] text-neutral-500">
                  {userData ? `${userData.integral} Integrals Available` : 'Free Tier'}
                </span>
             </div>
          </div>
          {toolData && (
            <div className="mt-2 text-[10px] text-center text-neutral-400">
              Costs {toolData.integral} integrals per generation
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-white dark:bg-neutral-950">
        <div className="mx-auto max-w-5xl p-10">
          <div className="mb-12">
            <h2 className="text-3xl font-bold tracking-tight">
              {mode === 'analysis' ? 'Analysis & Product Replacement' : 'Direct Style Generation'}
            </h2>
            <p className="mt-2 text-neutral-500">
              {mode === 'analysis' 
                ? 'Upload a reference composition and identify elements to keep while swapping your product.' 
                : 'Choose a professional aesthetic style and generate a unique product scene instantly.'}
            </p>
          </div>

          <div className="flex flex-col gap-12">
            {/* Control Panel */}
            <section className="flex flex-col gap-8 max-w-3xl mx-auto w-full">
              <div className="flex flex-col gap-6 lg:flex-row">
                {/* Left Column: Input Images */}
                <div className="flex flex-1 flex-col gap-6">
                  {mode === 'analysis' && (
                    <div className="flex flex-col gap-4">
                      <ImageUploader 
                        label="Step 1: Reference Composition" 
                        onUpload={setRefImage} 
                        preview={refImage} 
                      />
                      <button
                        onClick={handleAnalyze}
                        disabled={!refImage || analyzing}
                        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 py-3 font-bold text-white transition-all hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
                      >
                        {analyzing ? <Loader2 className="animate-spin" /> : <Sparkles size={18} />}
                        {analyzing ? 'Analyzing...' : 'Analyze Scene Elements'}
                      </button>
                    </div>
                  )}

                  <ImageUploader 
                    label={mode === 'analysis' ? "Step 2: Your Product Image" : "Featured Product Image"} 
                    onUpload={setProductImage} 
                    preview={productImage} 
                  />
                </div>

                {/* Right Column: Mode-specific Options */}
                <div className="flex flex-1 flex-col gap-4">
                  {mode === 'analysis' ? (
                    <div className="rounded-2xl border border-neutral-100 bg-neutral-50 p-6 flex-1 min-h-[300px] dark:border-neutral-800 dark:bg-neutral-900/50">
                      <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-neutral-400">Identified Elements</h4>
                      <div className="flex flex-wrap gap-2">
                        {mainSubject && (
                          <div className="flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-bold text-white shadow-lg ring-2 ring-neutral-900 dark:bg-white dark:text-neutral-900 dark:ring-white">
                            <Sparkles size={14} className="text-amber-400" />
                            Replace: {mainSubject}
                            <button onClick={() => setMainSubject('')} className="text-white/50 hover:text-white dark:text-neutral-900/50 dark:hover:text-neutral-900">
                              <X size={14} />
                            </button>
                          </div>
                        )}
                        {objects.map((obj, i) => (
                          <div key={i} className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-medium shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-800 dark:ring-neutral-700">
                            {obj}
                            <button onClick={() => setObjects(objects.filter((_, idx) => idx !== i))} className="text-neutral-400 hover:text-red-500">
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-1.5 shadow-sm ring-1 ring-neutral-200 focus-within:ring-2 focus-within:ring-neutral-900 dark:bg-neutral-800 dark:ring-neutral-700 dark:focus-within:ring-white">
                          <input 
                            type="text" 
                            placeholder="Add tag..."
                            className="flex-1 bg-transparent border-none p-0 text-sm focus:ring-0"
                            value={newObject}
                            onChange={(e) => setNewObject(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && newObject.trim()) {
                                setObjects([...objects, newObject.trim()]);
                                setNewObject('');
                              }
                            }}
                          />
                          <button 
                            onClick={() => {
                              if (newObject.trim()) {
                                setObjects([...objects, newObject.trim()]);
                                setNewObject('');
                              }
                            }}
                            className="text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-6 rounded-2xl border border-neutral-100 bg-neutral-50 p-6 dark:border-neutral-800 dark:bg-neutral-900/50">
                      <div className="flex flex-col gap-4">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Choose Aesthetic</span>
                        <div className="grid grid-cols-1 gap-3">
                          {beautyStyles.map(s => (
                            <button
                              key={s.name}
                              onClick={() => setSelectedStyle(s.name)}
                              className={`flex items-center justify-between rounded-xl px-5 py-4 text-left transition-all ${selectedStyle === s.name ? 'bg-neutral-900 text-white shadow-lg dark:bg-white dark:text-neutral-900' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800'}`}
                            >
                              <span className="font-bold">{s.name}</span>
                              <ChevronRight size={16} />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating || (mode === 'analysis' && (!refImage || !productImage))}
                className="group mt-4 flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-neutral-800 to-neutral-950 py-5 text-lg font-bold text-white shadow-xl transition-all hover:scale-[1.02] active:scale-95 disabled:scale-100 disabled:opacity-50 dark:from-neutral-200 dark:to-white dark:text-neutral-950"
              >
                {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {generating ? (mode === 'analysis' ? 'Generating Replacement...' : 'Crafting Your Image...') : (mode === 'analysis' ? 'Generate Ecommerce Image' : 'Generate Beauty Shot (1 Image)')}
              </button>
            </section>
          </div>
        </div>
      </main>

      {/* Fullscreen Modal */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-10 backdrop-blur-xl"
          >
            <button 
              onClick={() => setSelectedImage(null)}
              className="absolute top-10 right-10 text-white/50 hover:text-white transition-colors"
            >
              <X size={32} />
            </button>
            
            <div className="relative flex max-h-full max-w-full flex-col items-center gap-6">
              <img 
                src={selectedImage} 
                alt="Fullscreen Preview" 
                className="max-h-[80vh] w-auto rounded-xl shadow-2xl"
              />
              <div className="flex gap-4">
                <button 
                  onClick={() => downloadImage(selectedImage)}
                  className="flex items-center gap-2 rounded-full bg-white px-8 py-3 font-bold text-black shadow-xl transition-transform hover:scale-105 active:scale-95"
                >
                  <Download size={20} />
                  Download 4K Quality
                </button>
                <button 
                  onClick={() => {
                    const item = history.find(h => h.url === selectedImage);
                    if (item) deleteHistory(item.id);
                    setSelectedImage(null);
                  }}
                  className="flex items-center gap-2 rounded-full bg-red-500/20 px-8 py-3 font-bold text-red-500 backdrop-blur-md transition-transform hover:scale-105 active:scale-95"
                >
                  <Trash2 size={20} />
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
