# 🖨️ Print Quality Auditor – Documentation Index

## Running the dashboard on this computer (no internet needed)

```powershell
cd "C:\Users\andre\Upscaled\Print Quality Auditor"
.\run_auditor.ps1
```

This starts `auditor_server.py` at http://127.0.0.1:8792 and opens your browser. The page then offers **Open a
delivered file…** (every PDF, TIFF, PNG, JPEG or WebP in the pipeline's output folder and its batch folders) and, in
**Follow a batch**, a folder list plus a **Follow** button that re-reads that folder's `batch_status.json` every
3 seconds. PDF deliveries written by the pipeline are decoded directly. Close the PowerShell window to stop.
At the bottom, **5 · Upscale pipeline workflow** follows the whole job every 10 seconds until it is complete: draft
folder, images in `input` still to print, running or stalled batches with their print-quality counts, TIFFs that
still need a PDF (`tiff_to_pdf.py`), which batches have an audit report, disk space against the remaining need, and
a "Next:" line with the one thing to do now.
The libraries the page needs are in `vendor\`; the published copy at https://claude.ai/artifact/BxN4SXQyh3HDtxGUKdrm6Z
has the same fixes but can only read files you drop onto it. Batch reports: `batch_01_audit.md` / `.csv`.


**Project:** Fine Art Print Upscaling with Prepress Quality Assurance  
**File Audited:** `imgi_11_top20-220x220-wpa_100x100cm_150ppi.tif`  
**Audit Date:** 2026-09-15  
**Quality Score:** 7.0 / 10.0 (Acceptable with Caveats)

---

## 📚 Documentation Map

### **1. Core Audit Reports** (START HERE)

#### **[AUDIT_REPORT.md](./AUDIT_REPORT.md)** ⭐ PRIMARY DOCUMENT
- **Purpose:** Complete prepress analysis of your fine art image file
- **Content:** 
  - Executive Summary (1 page)
  - Detailed Tier Analysis (Tier C: Large Format)
  - Critical findings & rectification actions (5 issues)
  - Shadow/blending/transparency deconstruction
  - Visual legibility testing
  - Master Audit Matrix (10 metrics × 3 grades)
  - Technical Rectification Checklist (12 steps)
  - Risk assessment table
  - Closing assessment & confidence levels
- **Audience:** You, your print shop, color management specialists
- **When to Use:** 
  - Understand WHY your file got 7.0/10.0
  - Know what issues to fix before printing
  - Follow step-by-step rectification blueprint
  - Share technical details with print shop

---

#### **[QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt](./QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt)** ⭐ ACTION GUIDE
- **Purpose:** Executable workflow for print shop submission
- **Content:**
  - Copy-paste email template for print shop
  - 3 scenario paths (Offset Litho, Digital Wide-Format, Current PPI)
  - Color space conversion checklist (CMYK or sRGB)
  - Step-by-step Photoshop instructions
  - Glossary (PPI, CMYK, ICC, TAC, etc.)
  - Risk mitigation table
- **Audience:** You preparing files for submission
- **When to Use:**
  - BEFORE contacting print shop (use email template)
  - WHILE converting color space (follow checklist)
  - TO UNDERSTAND technical terms (glossary)
  - TO MITIGATE risks (risk table)

---

### **2. Pipeline Configuration Docs** (RELATED TO UPSCALED PROJECT)

#### **[../Upscaled/FINE_ART_PIPELINE_LOCKDOWN.md](../Upscaled/FINE_ART_PIPELINE_LOCKDOWN.md)** 🔐 PIPELINE MANAGEMENT
- **Purpose:** Ensure your upscale pipeline outputs correct files for fine art
- **Content:**
  - Current pipeline verification (✅ already configured correctly)
  - Color space decision tree (sRGB vs Adobe RGB vs Custom)
  - How to change ICC profiles in .env
  - Lock-in checklist (5 configuration points)
  - Batch verification procedures
  - Fine art print shop communication template
- **Audience:** You managing the upscale pipeline
- **When to Use:**
  - After print shop confirms color space
  - When running new batches (verify spec sheet)
  - To change ICC profile (follow instructions)
  - To lock in configuration for consistency

---

#### **[../Upscaled/FINAL_PREPRESS_ACTION_PLAN.txt](../Upscaled/FINAL_PREPRESS_ACTION_PLAN.txt)** 📋 UNIFIED ROADMAP
- **Purpose:** Complete workflow from audit → pipeline → print shop
- **Content:**
  - 6 Priority action items (in order)
  - Email templates for print shop
  - Complete command line examples
  - Verification checklists for each step
  - Workflow summary diagram
  - Current status summary
  - Next actions (1-6)
- **Audience:** You managing the entire project
- **When to Use:**
  - TODAY → Send Priority 1 email
  - After they respond → Follow Priority 2-6
  - When running batches → Refer to locked configuration
  - For tracking progress → Check off each priority

---

### **3. Reference Copy**

#### **[../Upscaled/PREPRESS_AUDIT_imgi_11_top20_220_wpa.md](../Upscaled/PREPRESS_AUDIT_imgi_11_top20_220_wpa.md)** 📄 BACKUP
- Identical copy of AUDIT_REPORT.md (for reference in Upscaled folder)
- Kept with pipeline files for easy access during batches

---

## 🎯 Quick Navigation by Use Case

### **"I just want to know if my file is ready to print"**
→ Read: [AUDIT_REPORT.md](./AUDIT_REPORT.md) **Executive Summary** (pages 1-2)  
→ Answer: **7.0/10.0 – Acceptable with Caveats**  
→ Action: Confirm color space with print shop

---

### **"I need to email my print shop right now"**
→ Use: [QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt](./QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt) **Step 1**  
→ Copy-paste email template, fill in print shop name  
→ Include: `--icc_target` question (sRGB OK, or Adobe RGB, or custom?)

---

### **"I need to convert my file to CMYK (or sRGB)"**
→ Use: [QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt](./QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt) **Step 2**  
→ Follow: Scenario A (CMYK) or Scenario B (sRGB)  
→ Commands: Copy-paste Photoshop steps

---

### **"My print shop said 'use Adobe RGB' – what do I do?"**
→ Read: [../Upscaled/FINE_ART_PIPELINE_LOCKDOWN.md](../Upscaled/FINE_ART_PIPELINE_LOCKDOWN.md) **"If Print Shop Says Adobe RGB"**  
→ Action: Download AdobeRGB1998.icc profile  
→ Update: Uncomment ICC_TARGET in .env  
→ Run: Next batch (pipeline handles conversion)

---

### **"I want to verify my pipeline outputs correct files"**
→ Read: [../Upscaled/FINE_ART_PIPELINE_LOCKDOWN.md](../Upscaled/FINE_ART_PIPELINE_LOCKDOWN.md) **Lock-in Checklist**  
→ Verify: .env has correct settings  
→ Test: Run one batch and check `_SPEC.txt`

---

### **"I need the complete workflow from start to finish"**
→ Read: [../Upscaled/FINAL_PREPRESS_ACTION_PLAN.txt](../Upscaled/FINAL_PREPRESS_ACTION_PLAN.txt)  
→ Follow: Priorities 1-6 in order  
→ Track: Check off each action as you complete it

---

## 📊 Document Relationships

```
┌─────────────────────────────────────────────────────────────┐
│         PREPRESS AUDIT (Your File Quality)                 │
│  ┌─────────────────────────────────────────────────────────┤
│  │  AUDIT_REPORT.md (Technical Analysis)                   │
│  │  • Quality Score: 7.0/10.0                              │
│  │  • 5 Critical Findings                                  │
│  │  • Rectification Checklist                              │
│  └─────────────────────────────────────────────────────────┘
│           ↓ (Output & Recommendations) ↓
│  ┌─────────────────────────────────────────────────────────┤
│  │  QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt                   │
│  │  • Email Template (Send to Print Shop)                  │
│  │  • Color Space Decision (sRGB? CMYK? Custom?)           │
│  │  • Conversion Checklist (Photoshop steps)               │
│  └─────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
                      ↓ (Print Shop Response)
┌─────────────────────────────────────────────────────────────┐
│      PIPELINE CONFIGURATION (Upscaled System)               │
│  ┌─────────────────────────────────────────────────────────┤
│  │  FINAL_PREPRESS_ACTION_PLAN.txt (Unified Roadmap)       │
│  │  • Priorities 1-6                                       │
│  │  • All email templates                                  │
│  │  • All commands                                         │
│  └─────────────────────────────────────────────────────────┘
│           ↓ (After Color Space Confirmed) ↓
│  ┌─────────────────────────────────────────────────────────┤
│  │  FINE_ART_PIPELINE_LOCKDOWN.md (Lock In Config)         │
│  │  • Update .env (ICC profile)                            │
│  │  • Run batches with confidence                          │
│  │  • Verify outputs (check spec sheet)                    │
│  └─────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
                      ↓ (Production Ready)
              All Future Batches ✅
```

---

## ✅ File Connectivity Verification

| Document | Location | Purpose | Status |
|----------|----------|---------|--------|
| AUDIT_REPORT.md | Print Quality Auditor/ | Technical analysis | ✅ Present |
| QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt | Print Quality Auditor/ | Action guide | ✅ Present |
| FINE_ART_PIPELINE_LOCKDOWN.md | Upscaled/ | Pipeline management | ✅ Present |
| FINAL_PREPRESS_ACTION_PLAN.txt | Upscaled/ | Unified roadmap | ✅ Present |
| PREPRESS_AUDIT_imgi_11_top20_220_wpa.md | Upscaled/ | Backup copy | ✅ Present |

**All documents are properly linked and cross-referenced. ✅**

---

## 🚀 START HERE

### **For First-Time Reading:**
1. Read this INDEX.md (you are here)
2. Open [AUDIT_REPORT.md](./AUDIT_REPORT.md) → Executive Summary
3. Open [QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt](./QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt) → Step 1
4. Send the email to your print shop TODAY

### **After Print Shop Responds:**
5. Open [../Upscaled/FINAL_PREPRESS_ACTION_PLAN.txt](../Upscaled/FINAL_PREPRESS_ACTION_PLAN.txt)
6. Follow Priorities 2-6 based on their response

### **When Running Future Batches:**
7. Refer to [../Upscaled/FINE_ART_PIPELINE_LOCKDOWN.md](../Upscaled/FINE_ART_PIPELINE_LOCKDOWN.md)
8. Use the lock-in checklist for each batch

---

## 📞 Support

**Questions about the audit?** → Read AUDIT_REPORT.md (answers are there)  
**Questions about print shop submission?** → Read QUICK_REFERENCE_PRINT_SHOP_GUIDE.txt  
**Questions about pipeline configuration?** → Read FINE_ART_PIPELINE_LOCKDOWN.md  
**Questions about the overall workflow?** → Read FINAL_PREPRESS_ACTION_PLAN.txt  

---

**Generated:** 2026-09-15  
**Audit Confidence:** 90%+  
**Pipeline Status:** Production-Ready ✅  
**Next Action:** Send Priority 1 email to print shop (TODAY)
