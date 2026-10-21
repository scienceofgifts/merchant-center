import React, { useState } from 'react';
import {
  X,
  Plus,
  Trash2,
  Save,
  Check,
  Cpu,
  Layers,
  Users,
  Calendar,
  DollarSign,
  Tag,
  Sparkles,
} from 'lucide-react';
import { StrategyConfig, ThemeConfig, GiftAudienceConfig, ProductGroupConfig } from '../types/feed';
import { FolderKanban } from 'lucide-react';

interface StrategyConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: StrategyConfig;
  onSaveConfig: (updated: StrategyConfig) => Promise<void>;
}

export const StrategyConfigModal: React.FC<StrategyConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [activeTab, setActiveTab] = useState<
    'product_groups' | 'themes' | 'audiences' | 'occasions' | 'custom_labels' | 'model'
  >('product_groups');
  const [formData, setFormData] = useState<StrategyConfig>(JSON.parse(JSON.stringify(config)));
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSaveConfig(formData);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      console.error('Save config error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Product Group Helpers
  const addProductGroup = () => {
    const newGroup: ProductGroupConfig = {
      id: `grp_${Date.now()}`,
      name: 'New Product Group',
      subgroups: ['General'],
      description: 'Internal Science of Gifts categorization domain.',
    };
    setFormData({
      ...formData,
      productGroups: [...(formData.productGroups || []), newGroup],
    });
  };

  const updateProductGroup = (index: number, updated: Partial<ProductGroupConfig>) => {
    const next = [...(formData.productGroups || [])];
    next[index] = { ...next[index], ...updated };
    setFormData({ ...formData, productGroups: next });
  };

  const removeProductGroup = (index: number) => {
    const next = (formData.productGroups || []).filter((_, i) => i !== index);
    setFormData({ ...formData, productGroups: next });
  };

  // Theme Helpers
  const addTheme = () => {
    const newTheme: ThemeConfig = {
      id: `theme_${Date.now()}`,
      name: 'New Collection Theme',
      subthemes: ['General'],
      keywords: ['gift', 'collection'],
    };
    setFormData({ ...formData, themes: [...formData.themes, newTheme] });
  };

  const updateTheme = (index: number, updated: Partial<ThemeConfig>) => {
    const nextThemes = [...formData.themes];
    nextThemes[index] = { ...nextThemes[index], ...updated };
    setFormData({ ...formData, themes: nextThemes });
  };

  const removeTheme = (index: number) => {
    const nextThemes = formData.themes.filter((_, i) => i !== index);
    setFormData({ ...formData, themes: nextThemes });
  };

  // Audience Helpers
  const addAudience = () => {
    const newAudience: GiftAudienceConfig = {
      id: `aud_${Date.now()}`,
      name: 'New Gift Audience',
      description: 'Audience description and interests',
    };
    setFormData({ ...formData, giftAudiences: [...formData.giftAudiences, newAudience] });
  };

  const updateAudience = (index: number, updated: Partial<GiftAudienceConfig>) => {
    const next = [...formData.giftAudiences];
    next[index] = { ...next[index], ...updated };
    setFormData({ ...formData, giftAudiences: next });
  };

  const removeAudience = (index: number) => {
    const next = formData.giftAudiences.filter((_, i) => i !== index);
    setFormData({ ...formData, giftAudiences: next });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              Science of Gifts Strategy & Taxonomy Configuration
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Configure internal brand taxonomy, gift audiences, custom labels, and Gemini reasoning model.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-800 bg-slate-900/50 overflow-x-auto">
          <button
            onClick={() => setActiveTab('product_groups')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition ${
              activeTab === 'product_groups'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5 text-indigo-400" />
            <span>Product Groups ({(formData.productGroups || []).length})</span>
          </button>

          <button
            onClick={() => setActiveTab('themes')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition ${
              activeTab === 'themes'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Themes & Collections ({formData.themes.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('audiences')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition ${
              activeTab === 'audiences'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Gift Audiences ({formData.giftAudiences.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('occasions')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition ${
              activeTab === 'occasions'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Occasions & Personas</span>
          </button>

          <button
            onClick={() => setActiveTab('custom_labels')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition ${
              activeTab === 'custom_labels'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Custom Labels Strategy</span>
          </button>

          <button
            onClick={() => setActiveTab('model')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition ${
              activeTab === 'model'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Gemini Model</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* PRODUCT GROUPS TAB */}
          {activeTab === 'product_groups' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    Internal Product Groups & Subgroups
                  </h4>
                  <p className="text-xs text-slate-400">
                    Controls the primary domain context for AI optimization (e.g. History vs TV & Film vs Music).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addProductGroup}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Product Group</span>
                </button>
              </div>

              <div className="space-y-3">
                {(formData.productGroups || []).map((grp, idx) => (
                  <div
                    key={grp.id || idx}
                    className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <input
                        type="text"
                        value={grp.name}
                        onChange={(e) => updateProductGroup(idx, { name: e.target.value })}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-bold flex-1"
                        placeholder="Product Group Name (e.g. TV & Film)"
                      />
                      <button
                        type="button"
                        onClick={() => removeProductGroup(idx)}
                        className="p-1.5 text-rose-400 hover:bg-rose-950/60 rounded-lg transition"
                        title="Delete Product Group"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Subgroups / Collections (Comma-separated)
                      </label>
                      <input
                        type="text"
                        value={(grp.subgroups || []).join(', ')}
                        onChange={(e) =>
                          updateProductGroup(idx, {
                            subgroups: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                        placeholder="e.g. How I Met Your Mother, Film, TV, Filmmakers"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Domain Context / Rationale
                      </label>
                      <input
                        type="text"
                        value={grp.description || ''}
                        onChange={(e) => updateProductGroup(idx, { description: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300"
                        placeholder="Group description..."
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* THEMES TAB */}
          {activeTab === 'themes' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    Thematic Catalog Taxonomy
                  </h4>
                  <p className="text-xs text-slate-400">
                    The AI uses these themes for product understanding and campaign segmentation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addTheme}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Theme</span>
                </button>
              </div>

              <div className="space-y-3">
                {formData.themes.map((theme, idx) => (
                  <div key={theme.id || idx} className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <input
                        type="text"
                        value={theme.name}
                        onChange={(e) => updateTheme(idx, { name: e.target.value })}
                        className="flex-1 bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1 text-xs font-semibold text-slate-100"
                        placeholder="Theme Name (e.g. Ancient Rome & Greece)"
                      />
                      <button
                        onClick={() => removeTheme(idx)}
                        className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-900"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">
                          Subthemes (comma separated)
                        </label>
                        <input
                          type="text"
                          value={theme.subthemes.join(', ')}
                          onChange={(e) =>
                            updateTheme(idx, {
                              subthemes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                            })
                          }
                          className="w-full bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-slate-300"
                          placeholder="Subthemes..."
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">
                          Thematic Search Keywords
                        </label>
                        <input
                          type="text"
                          value={theme.keywords.join(', ')}
                          onChange={(e) =>
                            updateTheme(idx, {
                              keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                            })
                          }
                          className="w-full bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-slate-300"
                          placeholder="Keywords..."
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AUDIENCES TAB */}
          {activeTab === 'audiences' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    Target Gift Audiences
                  </h4>
                  <p className="text-xs text-slate-400">
                    Audiences targeted for Google Shopping campaign labels and search intent mapping.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addAudience}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Audience</span>
                </button>
              </div>

              <div className="space-y-3">
                {formData.giftAudiences.map((aud, idx) => (
                  <div key={aud.id || idx} className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                    <div className="space-y-2 flex-1">
                      <input
                        type="text"
                        value={aud.name}
                        onChange={(e) => updateAudience(idx, { name: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1 text-xs font-semibold text-slate-100"
                        placeholder="Audience Name"
                      />
                      <input
                        type="text"
                        value={aud.description}
                        onChange={(e) => updateAudience(idx, { description: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700/60 rounded px-2.5 py-1 text-xs text-slate-400"
                        placeholder="Audience description..."
                      />
                    </div>
                    <button
                      onClick={() => removeAudience(idx)}
                      className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-900"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OCCASIONS & PERSONAS TAB */}
          {activeTab === 'occasions' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-200 uppercase tracking-wider block mb-1">
                  Gift Occasions (comma separated)
                </label>
                <textarea
                  value={formData.occasions.join(', ')}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      occasions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg p-2.5 text-xs text-slate-200"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 uppercase tracking-wider block mb-1">
                  Recipient Personas (comma separated)
                </label>
                <textarea
                  value={formData.recipientPersonas.join(', ')}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      recipientPersonas: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg p-2.5 text-xs text-slate-200"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-200 uppercase tracking-wider block mb-1">
                  Seasonality Segments (comma separated)
                </label>
                <input
                  type="text"
                  value={formData.seasonality.join(', ')}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      seasonality: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg p-2.5 text-xs text-slate-200"
                />
              </div>
            </div>
          )}

          {/* CUSTOM LABELS STRATEGY TAB */}
          {activeTab === 'custom_labels' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Merchant Center Custom Label Definitions
                </h4>
                <p className="text-xs text-slate-400">
                  Custom labels segment your feed for Google Shopping ad campaign bidding and catalog structure.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(formData.customLabelMappings).map(([key, val]) => (
                  <div key={key} className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="font-mono text-xs font-bold text-indigo-400 uppercase">
                      {key}
                    </span>
                    <input
                      type="text"
                      value={val}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          customLabelMappings: {
                            ...formData.customLabelMappings,
                            [key]: e.target.value,
                          },
                        })
                      }
                      className="w-full bg-slate-900 border border-slate-700/80 rounded px-2.5 py-1 text-xs text-slate-200"
                      placeholder={`Definition for ${key}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* GEMINI MODEL TAB */}
          {activeTab === 'model' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  AI Model Configuration
                </h4>
                <p className="text-xs text-slate-400">
                  Select the Google Gemini model used for product strategy analysis, title scoring, and quality audit.
                </p>
              </div>

              <div className="space-y-2">
                {[
                  {
                    id: 'gemini-3.5-flash-lite',
                    name: 'Gemini 3.5 Flash Lite (Default / Fast & Efficient)',
                    desc: 'Optimized for high-throughput catalog batch processing with rapid intent extraction.',
                  },
                  {
                    id: 'gemini-3.8-flash',
                    name: 'Gemini 3.8 Flash (Deep Reasoning & Complex Text)',
                    desc: 'Recommended for comprehensive title scoring and detailed editorial audits.',
                  },
                ].map((m) => (
                  <label
                    key={m.id}
                    className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition ${
                      formData.geminiModel === m.id
                        ? 'bg-indigo-950/30 border-indigo-500/60 text-slate-100'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:bg-slate-900/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="geminiModel"
                      value={m.id}
                      checked={formData.geminiModel === m.id}
                      onChange={(e) => setFormData({ ...formData, geminiModel: e.target.value })}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">{m.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{m.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900/50">
          <div className="text-xs text-slate-400">
            {savedSuccess && (
              <span className="flex items-center gap-1 text-emerald-400">
                <Check className="w-4 h-4" /> Strategy Configuration Saved!
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : 'Save Strategy Settings'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
