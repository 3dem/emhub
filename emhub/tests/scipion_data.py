# ******************************************************************************
# *
# * Authors:     Yunior C. Fonseca Reyna
# *
# * Unidad de  Bioinformatica of Centro Nacional de Biotecnologia , CSIC
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# * This program is distributed in the hope that it will be useful,
# * but WITHOUT ANY WARRANTY; without even the implied warranty of
# * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# * GNU General Public License for more details.
# *
# * You should have received a copy of the GNU General Public License
# * along with this program; if not, write to the Free Software
# * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA
# * 02111-1307  USA
# *
# *  All comments concerning this program package may be sent to the
# *  e-mail address 'scipion@cnb.csic.es'
# *
# ******************************************************************************

# backend/data.py
# In-memory a list of projects + a dict with full project details (protocols)

projects = [
    {
        "id": 43,
        "name": "TestCryosparc3DClassification",
        "description": "TestCryosparc3DClassification1",
        "status": "active",
        "createdAt": "2025-09-13T15:29:00.670242+02:00",
        "updatedAt": None,
        "protocolsCount": 9,
        "diskUsage": "0.28 GB",
    },
]

projectDetails = {
    43: {
        "id": 43,
        "name": "/home/yunior/ScipionUserData/projects/TestCryosparc3DClassification",
        "shortName": "TestCryosparc3DClassification",
        "createdAt": "2025-09-13 15:29:00.670242+02:00",
        "status": "active",
        "path": "/home/yunior/ScipionUserData/projects/TestCryosparc3DClassification",
        "protocols": {
            "2": {
                "id": "2",
                "children": ["134", "265", "406", "870"],
                "parents": ["PROJECT"],
                "label": "* pwem - import particles",
                "status": "finished",
                "parameter": [],
                "inputs": [],
                "outputs": [
                    {
                        "outputParticles": {
                            "_class": "SetOfParticles",
                            "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "pwem - import particles.outputParticles",
                            "_parentId": 2,
                        }
                    }
                ],
                "cpuTime": "0",
                "elapsedTime": "0",
                "isInteractive": False,
                "numberOfSteps": 1,
                "stepsDone": 1,
            },
            "79": {
                "id": "79",
                "children": ["134", "265", "406"],
                "parents": ["PROJECT"],
                "label": "* pwem - import volumes",
                "status": "finished",
                "parameter": [],
                "inputs": [],
                "outputs": [
                    {
                        "outputVolume": {
                            "_class": "Volume",
                            "info": "Volume (64 x 64 x 64, 4.00 Å/px)",
                            "_objValue": "pwem - import volumes.outputVolume",
                            "_parentId": 79,
                        }
                    }
                ],
                "cpuTime": "0",
                "elapsedTime": "0",
                "isInteractive": False,
                "numberOfSteps": 1,
                "stepsDone": 1,
            },
            "134": {
  "protocolId": "134",
  "children": [
  ],
  "parents": [
    "2",
    "79"
  ],
  "label": "protNonUniform3DRefinement_1",
  "status": "finished",
  "parameter": [],
  "inputs": [
    {
      "name": "inputParticles",
      "paramClass": "PointerParam",
      "pointerClass": "SetOfParticles",
      "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
      "value": "2.outputParticles",
      "parentId": 2
    },
    {
      "name": "referenceVolume",
      "paramClass": "PointerParam",
      "pointerClass": "Volume",
      "info": "Volume (64 x 64 x 64, 4.00 Å/px)",
      "value": "79.outputVolume",
      "parentId": 79
    }
  ],
  "outputs": [
    {
      "name": "outputVolume",
      "paramClass": "PointerParam",
      "pointerClass": "Volume",
      "info": "Volume (140 x 140 x 140, 4.00 Å/px) - w/halves",
      "value": "134.outputVolume",
      "parentId": 134
    },
    {
      "name": "outputParticles",
      "paramClass": "PointerParam",
      "pointerClass": "SetOfParticles",
      "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
      "value": "134.outputParticles",
      "parentId": 134
    },
    {
      "name": "outputFSC",
      "paramClass": "PointerParam",
      "pointerClass": "SetOfFSCs",
      "info": "SetOfFSCs            (5 items)",
      "value": "134.outputFSC",
      "parentId": 134
    }
  ],
  "cpuTime": "102",
  "elapsedTime": "102",
  "isInteractive": False,
  "numberOfSteps": 3,
  "stepsDone": 3
},
            "265": {
                "id": "265",
                "children": ["547", "622"],
                "parents": ["2", "79"],
                "label": "protNonUniform3DRefinement_2",
                "status": "finished",
                "parameter": [],
                "inputs": [
                    {
                        "inputParticles": {
                            "_class": "SetOfParticles",
                            "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "pwem - import particles.outputParticles",
                            "_parentId": 2,
                        }
                    },
                    {
                        "referenceVolume": {
                            "_class": "Volume",
                            "info": "Volume (64 x 64 x 64, 4.00 Å/px)",
                            "_objValue": "pwem - import volumes.outputVolume",
                            "_parentId": 79,
                        }
                    },
                ],
                "outputs": [
                    {
                        "outputVolume": {
                            "_class": "Volume",
                            "info": "Volume (140 x 140 x 140, 4.00 Å/px) - w/halves",
                            "_objValue": "protNonUniform3DRefinement_2.outputVolume",
                            "_parentId": 265,
                        }
                    },
                    {
                        "outputParticles": {
                            "_class": "SetOfParticles",
                            "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "protNonUniform3DRefinement_2.outputParticles",
                            "_parentId": 265,
                        }
                    },
                    {
                        "outputFSC": {
                            "_class": "SetOfFSCs",
                            "info": "SetOfFSCs            (5 items)",
                            "_objValue": "protNonUniform3DRefinement_2.outputFSC",
                            "_parentId": 265,
                        }
                    },
                ],
                "cpuTime": "89",
                "elapsedTime": "92",
                "isInteractive": False,
                "numberOfSteps": 3,
                "stepsDone": 3,
            },
            "406": {
                "id": "406",
                "children": ["547", "622"],
                "parents": ["2", "79"],
                "label": "protNonUniform3DRefinement_3",
                "status": "finished",
                "parameter": [],
                "inputs": [
                    {
                        "inputParticles": {
                            "_class": "SetOfParticles",
                            "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "pwem - import particles.outputParticles",
                            "_parentId": 2,
                        }
                    },
                    {
                        "referenceVolume": {
                            "_class": "Volume",
                            "info": "Volume (64 x 64 x 64, 4.00 Å/px)",
                            "_objValue": "pwem - import volumes.outputVolume",
                            "_parentId": 79,
                        }
                    },
                ],
                "outputs": [
                    {
                        "outputVolume": {
                            "_class": "Volume",
                            "info": "Volume (140 x 140 x 140, 4.00 Å/px) - w/halves",
                            "_objValue": "protNonUniform3DRefinement_3.outputVolume",
                            "_parentId": 406,
                        }
                    },
                    {
                        "outputParticles": {
                            "_class": "SetOfParticles",
                            "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "protNonUniform3DRefinement_3.outputParticles",
                            "_parentId": 406,
                        }
                    },
                    {
                        "outputFSC": {
                            "_class": "SetOfFSCs",
                            "info": "SetOfFSCs            (5 items)",
                            "_objValue": "protNonUniform3DRefinement_3.outputFSC",
                            "_parentId": 406,
                        }
                    },
                ],
                "cpuTime": "110",
                "elapsedTime": "113",
                "isInteractive": False,
                "numberOfSteps": 3,
                "stepsDone": 3,
            },
            "547": {
                "id": "547",
                "children": ["622"],
                "parents": ["134", "265", "406"],
                "label": "* Single particles union",
                "status": "finished",
                "parameter": [],
                "inputs": [
                    {
                        "inputSets": {
                            "_class": "SetOfParticles",
                            "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "protNonUniform3DRefinement_1.outputParticles",
                            "_parentId": 134,
                        }
                    },
                    {
                        "inputSets": {
                            "_class": "SetOfParticles",
                            "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "protNonUniform3DRefinement_2.outputParticles",
                            "_parentId": 265,
                        }
                    },
                    {
                        "inputSets": {
                            "_class": "SetOfParticles",
                            "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "protNonUniform3DRefinement_3.outputParticles",
                            "_parentId": 406,
                        }
                    },
                ],
                "outputs": [
                    {
                        "outputSet": {
                            "_class": "SetOfParticles",
                            "info": "Particles (1119 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "Single particles union.outputSet",
                            "_parentId": 547,
                        }
                    }
                ],
                "cpuTime": "0",
                "elapsedTime": "0",
                "isInteractive": False,
                "numberOfSteps": 1,
                "stepsDone": 1,
            },
            "622": {
                "id": "622",
                "children": [],
                "parents": ["547", "406", "265", "134"],
                "label": "cryosparc2 - 3D Classification6",
                "status": "finished",
                "parameter": [],
                "inputs": [
                    {
                        "inputParticles": {
                            "_class": "SetOfParticles",
                            "info": "Particles (1119 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "Single particles union.outputSet",
                            "_parentId": 547,
                        }
                    },
                    {
                        "refVolumes": {
                            "_class": "Volume",
                            "info": "Volume (140 x 140 x 140, 4.00 Å/px) - w/halves",
                            "_objValue": "protNonUniform3DRefinement_3.outputVolume",
                            "_parentId": 406,
                        }
                    },
                    {
                        "refVolumes": {
                            "_class": "Volume",
                            "info": "Volume (140 x 140 x 140, 4.00 Å/px) - w/halves",
                            "_objValue": "protNonUniform3DRefinement_2.outputVolume",
                            "_parentId": 265,
                        }
                    },
                    {
                        "refVolumes": {
                            "_class": "Volume",
                            "info": "Volume (140 x 140 x 140, 4.00 Å/px) - w/halves",
                            "_objValue": "protNonUniform3DRefinement_1.outputVolume",
                            "_parentId": 134,
                        }
                    },
                ],
                "outputs": [
                    {
                        "outputClasses": {
                            "_class": "SetOfClasses3D",
                            "info": "SetOfClasses3D       (3 items)",
                            "_objValue": "cryosparc2 - 3D Classification6.outputClasses",
                            "_parentId": 622,
                        }
                    },
                    {
                        "outputVolumes": {
                            "_class": "SetOfVolumes",
                            "info": "Volumes (3 items, 140 x 140 x 140, 4.00 Å/px)",
                            "_objValue": "cryosparc2 - 3D Classification6.outputVolumes",
                            "_parentId": 622,
                        }
                    },
                    {
                        "solventMask": {
                            "_class": "VolumeMask",
                            "info": "VolumeMask (140 x 140 x 140, 4.00 Å/px)",
                            "_objValue": "cryosparc2 - 3D Classification6.solventMask",
                            "_parentId": 622,
                        }
                    },
                ],
                "cpuTime": "98",
                "elapsedTime": "99",
                "isInteractive": False,
                "numberOfSteps": 3,
                "stepsDone": 3,
            },
            "870": {
                "id": "870",
                "children": [],
                "parents": ["2"],
                "label": "cryosparc2 - 2D classification",
                "status": "finished",
                "parameter": [],
                "inputs": [
                    {
                        "inputParticles": {
                            "_class": "SetOfParticles",
                            "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
                            "_objValue": "pwem - import particles.outputParticles",
                            "_parentId": 2,
                        }
                    }
                ],
                "outputs": [
                    {
                        "outputClasses": {
                            "_class": "SetOfClasses2D",
                            "info": "SetOfClasses2D       (5 items)",
                            "_objValue": "cryosparc2 - 2D classification.outputClasses",
                            "_parentId": 870,
                        }
                    }
                ],
                "cpuTime": "47",
                "elapsedTime": "48",
                "isInteractive": False,
                "numberOfSteps": 3,
                "stepsDone": 3,
            },
            "PROJECT": {
                "id": "PROJECT",
                "children": ["2", "79"],
                "parents": [],
                "label": "PROJECT",
                "status": "",
                "parameter": [],
                "inputs": [],
                "outputs": [],
                "cpuTime": "",
                "elapsedTime": "",
                "isInteractive": False,
                "numberOfSteps": 0,
                "stepsDone": 0,
            },
        },
    }
}


protocolDetail = {

134: {
  "form": {
    "label": "3D non-uniform refinement",
    "protocolName": "protNonUniform3DRefinement_1",
    "status": "finished",
    "expertLevel": True,
    "color": "#D2F5CB",
    "projectName": "/home/yunior/ScipionUserData/projects/TestCryosparc3DClassification",
    "projectId": 44,
    "packageLogo": "/home/yunior/ScipionUserData/projects/TestCryosparc3DClassification/cryosparc2_logo.png",
    "protocolId": 134,
    "hosts": [
      "localhost"
    ],
    "favicon": "/home/yunior/ScipionUserData/projects/TestCryosparc3DClassification/favicon",
    "cite": [
      "*Package references:*",
      "[[http://doi.org/10.1038/nmeth.4169][Punjani et al., Nature Methods, 2017]] ",
      "[[http://ieeexplore.ieee.org/document/7740877][Brubaker et al., IEEE Trans. Pattern Anal. Mach. Intell., 2017]] ",
      "[[https://doi.org/10.5281/zenodo.3576630][Daniel Asarnow et al., Zenodo, 2019]] "
    ],
    "help": " Apply non-uniform refinement to achieve higher resolution and map\n    quality, especially for membrane proteins. Non-uniform refinement\n    iteratively accounts for regions of a structure that have disordered or\n    flexible density causing local loss of resolution. Accounting for these\n    regions and dynamically estimating their locations can significantly\n    improve resolution in other regions as well as overall map quality by\n    impacting the alignment of particles and reducing the tendency for\n    refinement algorithms to over-fit disordered regions.\n    ",
    "protocolClassName": "ProtCryoSparcNewNonUniformRefine3D",
    "stdoutLog": "Runs/000134_ProtCryoSparcNewNonUniformRefine3D/logs/run.stdout",
    "stderrLog": "Runs/000134_ProtCryoSparcNewNonUniformRefine3D/logs/run.stderr",
    "scheduleLog": "Runs/000134_ProtCryoSparcNewNonUniformRefine3D/logs/schedule.log",
    "inputs": [
      {
        "inputName": "inputParticles",
        "paramClass": "PointerParam",
        "pointerClass": "SetOfParticles",
        "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
        "value": "pwem - import particles.outputParticles",
        "parentId": 2
      },
      {
        "inputName": "referenceVolume",
        "paramClass": "PointerParam",
        "pointerClass": "Volume",
        "info": "Volume (64 x 64 x 64, 4.00 Å/px)",
        "value": "pwem - import volumes.outputVolume",
        "parentId": 79
      }
    ],
    "outputs": [
      {
        "outputName": "outputVolume",
        "paramClass": "PointerParam",
        "pointerClass": "Volume",
        "info": "Volume (140 x 140 x 140, 4.00 Å/px) - w/halves",
        "value": "protNonUniform3DRefinement_1.outputVolume",
        "parentId": 134
      },
      {
        "outputName": "outputParticles",
        "paramClass": "PointerParam",
        "pointerClass": "SetOfParticles",
        "info": "Particles (373 items, 140 x 140, 4.00 Å/px)",
        "value": "protNonUniform3DRefinement_1.outputParticles",
        "parentId": 134
      },
      {
        "outputName": "outputFSC",
        "paramClass": "PointerParam",
        "pointerClass": "SetOfFSCs",
        "info": "SetOfFSCs            (5 items)",
        "value": "protNonUniform3DRefinement_1.outputFSC",
        "parentId": 134
      }
    ],
    "definition": [
      {
        "label": "General",
        "params": [
          {
            "name": "runName",
            "label": "Run name:",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": True,
            "help": "Select run name label to identify this run.",
            "default": "",
            "paramClass": "StringParam"
          },
          {
            "name": "_objComment",
            "_objComment": {},
            "label": "Comment",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": True,
            "help": "Protocol comments",
            "paramClass": "StringParam",
            "default": "",
            "readOnly": False
          },
          {
            "name": "_useQueue",
            "label": "Use a queue engine?",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": True,
            "help": "\n    Click Yes if you want to send this execution to a queue engine like Slurm, Torque, ...\n    The queue commands to launch and stop jobs should be configured at\n    _/home/yunior/Yunior/Projects/ScipionWeb/ScipionAPI/scipion_home/config/hosts.conf_ file.\n    \n    See https://scipion-em.github.io/docs/release-3.0.0/docs/scipion-modes/host-configuration.html for more information.\n        ",
            "paramClass": "BooleanParam",
            "default": False,
            "readOnly": False
          },
          {
            "name": "_prerequisites",
            "_prerequisites": {},
            "label": "Wait for",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": True,
            "help": "\n    Specify a comma separated list of protocol IDs if you want\n    to *schedule* this protocol and wait for those protocols to finish before\n    starting this one.\n    \n    This function will allow you to \"schedule\" many\n    runs that will be executed after each other.\n     \n    See https://scipion-em.github.io/docs/release-3.0.0/docs/user/scipion-gui.html#waiting-for-other-protocols for more information.\n    ",
            "paramClass": "StringParam",
            "default": [],
            "readOnly": False
          },
          {
            "name": "gpuList",
            "label": "GPU IDs",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "This argument is necessary. By default, the protocol will attempt to launch on GPU 0. You can override the default allocation by providing a list of which GPUs (0,1,2,3, etc) to use. GPU are separated by \",\". For example: \"0,1,5\"",
            "default": "0",
            "paramClass": "StringParam"
          },
          {
            "name": "expertLevel",
            "label": "Expert Level",
            "display": 0,
            "choices": [
              "Normal",
              "Advanced"
            ],
            "condition": None,
            "_isImportant": True,
            "paramClass": "EnumParam",
            "default": 0,
            "readOnly": False
          },
          {
            "name": "runMode",
            "label": "Run Mode",
            "display": 0,
            "choices": [
              "Continue",
              "Restart"
            ],
            "condition": None,
            "_isImportant": True,
            "paramClass": "EnumParam",
            "default": 0,
            "readOnly": False
          }
        ]
      },
      {
        "label": "Input",
        "params": [
          {
            "name": "inputParticles",
            "label": "Input particles",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": True,
            "help": "Select the input images from the project.",
            "default": None,
            "pointerClass": "SetOfParticles",
            "pointerCondition": None,
            "allowsNone": False,
            "strictPointer": False,
            "paramClass": "PointerParam",
            "parentId": 2
          },
          {
            "name": "referenceVolume",
            "label": "Input volume",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": True,
            "help": "Initial reference 3D map, it should have the same dimensions and the same pixel size as your input particles.",
            "default": None,
            "pointerClass": "Volume",
            "pointerCondition": None,
            "allowsNone": False,
            "strictPointer": False,
            "paramClass": "PointerParam",
            "parentId": 79
          },
          {
            "name": "refMask",
            "label": "Mask to be applied to this map(Optional)",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "A volume mask containing a (soft) mask with the same dimensions as the reference(s), and values between 0 and 1, with 1 being 100% protein and 0 being 100% solvent. The reconstructed reference map will be multiplied by this mask. If no mask is given, a soft spherical mask based on the <radius> of the mask for the experimental images will be applied.",
            "default": None,
            "pointerClass": "VolumeMask",
            "pointerCondition": None,
            "allowsNone": True,
            "strictPointer": False,
            "paramClass": "PointerParam"
          }
        ]
      },
      {
        "label": "Homogeneous Refinement",
        "params": [
          {
            "name": "symmetryGroup",
            "label": "Symmetry",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Symmetry as defined by cryosparc. Please note that Dihedral symmetry in cryosparc is defined with respectto y axis (Dyn).\nIf no symmetry is present, use C1.\nSymmetry String (C, D, I, O, T). E.g. C1, D7, C4, etc",
            "default": "0",
            "display": 1,
            "choices": [
              "Cn (Cn)",
              "Dn (Dyn)",
              "T (T222)",
              "O (O)",
              "I1 (I222)",
              "I2 (I222r)"
            ],
            "paramClass": "EnumParam"
          },
          {
            "name": "symmetryOrder",
            "label": "Symmetry Order",
            "expertLevel": 0,
            "condition": "symmetryGroup==1 or symmetryGroup==0",
            "_isImportant": False,
            "help": "Order of symmetry.",
            "default": "1",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_symmetry_do_align",
            "label": "Do symmetry alignment",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Align the input structure to the symmetry axes",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_do_init_scale_est",
            "label": "Re-estimate greyscale level of input reference",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": None,
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_num_final_iterations",
            "label": "Number of extra final passes",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Number of extra passes through the data to do after the GS-FSC resolution has stopped improving",
            "default": "0",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_res_init",
            "label": "Initial lowpass resolution (A)",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Applied to input structure",
            "default": "30",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_res_gsfsc_split",
            "label": "GSFSC split resolution (A)",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Resolution beyond which two GS-FSC halves are independent",
            "default": "20",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_highpass_res",
            "label": "Highpass resolution (A)",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": None,
            "default": None,
            "paramClass": "IntParam"
          },
          {
            "name": "refine_clip",
            "label": "Enforce non-negativity",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Clip negative density. Probably should be False",
            "default": "False",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_window",
            "label": "Skip interpolant premult",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Softly window the structure in real space with a spherical window. Should be True",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_skip_premult",
            "label": "Window structure in real space",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Leave this as True",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_ignore_dc",
            "label": "Ignore DC component",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Ignore the DC component of images. Should be True",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_batchsize_init",
            "label": "Initial batchsize",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Number of images used in the initial iteration. Set to zero to autotune",
            "default": "0",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_batchsize_epsilon",
            "label": "Batchsize epsilon",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Controls batch size when autotuning batchsizes. Set closer to zero for larger batches",
            "default": "0.001",
            "paramClass": "FloatParam"
          },
          {
            "name": "refine_batchsize_snrfactor",
            "label": "Batchsize snrfactor",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Specifies the desired improvement in SNR from the images when autotuning batchsizes. Directly multiplies the number of images in the batch",
            "default": "40.0",
            "paramClass": "FloatParam"
          },
          {
            "name": "refine_scale_min",
            "label": "Minimize over per-particle scale",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": None,
            "default": "False",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_scale_start_iter",
            "label": "Scale min/use start iter",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Iteration to start minimizing over per-particle scale",
            "default": "0",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_noise_model",
            "label": "Noise model:",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Noise model to be used. Valid options are white, coloured or symmetric. Symmetric is the default, meaning coloured with radial symmetry",
            "default": "0",
            "display": 1,
            "choices": [
              "symmetric",
              "white",
              "coloured"
            ],
            "paramClass": "EnumParam"
          },
          {
            "name": "refine_noise_priorw",
            "label": "Noise priorw",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Weight of the prior for estimating noise (units of # of images)",
            "default": "50",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_noise_initw",
            "label": "Noise initw",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Weight of the initial noise estimate (units of # of images)",
            "default": "200",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_noise_init_sigmascale",
            "label": "Noise initial sigma-scale",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Scale factor initially applied to the base noise estimate",
            "default": "3",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_mask",
            "label": "Mask:",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Type of masking to use. Either \"dynamic\", \"static\", or \"None\"",
            "default": "0",
            "display": 1,
            "choices": [
              "dynamic",
              "static",
              "None"
            ],
            "paramClass": "EnumParam"
          },
          {
            "name": "refine_dynamic_mask_thresh_factor",
            "label": "Dynamic mask threshold (0-1)",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Level set threshold for selecting regions that are included in the dynamic mask. Probably don't need to change this",
            "default": "0.2",
            "paramClass": "FloatParam"
          },
          {
            "name": "refine_dynamic_mask_near_ang",
            "label": "Dynamic mask near (A)",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Controls extent to which mask is expanded. At the near distance, the mask value is 1.0 (in A)",
            "default": "6.0",
            "paramClass": "FloatParam"
          },
          {
            "name": "refine_dynamic_mask_far_ang",
            "label": "Dynamic mask far (A)",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Controls extent to which mask is expanded. At the far distance the mask value becomes 0.0 (in A)",
            "default": "14.0",
            "paramClass": "FloatParam"
          },
          {
            "name": "refine_dynamic_mask_start_res",
            "label": "Dynamic mask start resolution (A)",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Map resolution at which to start dynamic masking (in A)",
            "default": "12",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_dynamic_mask_use_abs",
            "label": "Dynamic mask use absolute value",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Include negative regions if they are more negative than the threshold",
            "default": "False",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_compute_batch_size",
            "label": "GPU batch size of images",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Batch size of images to process at a time on the GPU. If you run out of GPU memory, try setting this to a small number to override the auto-detect procedure.",
            "default": None,
            "paramClass": "IntParam"
          }
        ]
      },
      {
        "label": "Defocus Refinement",
        "params": [
          {
            "name": "refine_defocus_refine",
            "label": "Optimize per-particle defocus",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Minimize over per-particle defocus at each iteration of refinement. The optimal defocus will be used for backprojection as well, and will be written out at each iteration. Defocus refinement will start only once refinement with current defocus values converges. Beware that with small/disordered proteins, defocus refinement may actually make resolutions worse.",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "crl_num_plots",
            "label": "Num. particles to plot",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Number of particles to make plots for. After this many, stop plotting to save time.",
            "default": "3",
            "paramClass": "IntParam"
          },
          {
            "name": "crl_min_res_A",
            "label": "Minimum Fit Res (A)",
            "expertLevel": 0,
            "condition": "refine_defocus_refine==True",
            "_isImportant": False,
            "help": "The minimum resolution to use during refinement of image aberrations.",
            "default": "20",
            "paramClass": "FloatParam"
          },
          {
            "name": "crl_df_range",
            "label": "Defocus Search Range (A +/-)",
            "expertLevel": 0,
            "condition": "refine_defocus_refine==True",
            "_isImportant": False,
            "help": "Defocus search range in Angstroms, searching both above and below the input defocus by this amount",
            "default": "2000",
            "paramClass": "FloatParam"
          },
          {
            "name": "crl_compute_batch_size",
            "label": "GPU batch size of images",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": None,
            "default": None,
            "paramClass": "IntParam"
          }
        ]
      },
      {
        "label": "Global CTF Refinement",
        "params": [
          {
            "name": "refine_ctf_global_refine",
            "label": "Optimize per-group CTF params",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Optimize the per-exposure-group CTF parameters (for higher-order aberrations) at each iteration of refinement. The optimal CTF will be used for backprojection as well, and will be written out at each iteration. CTF refinement will start only once refinement with current CTF values converges. Beware that with small/disordered proteins, CTF refinement may actually make resolutions worse.",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "crg_num_plots",
            "label": "Num. groups to plot",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": "Number of exposure groups to make plots for. After this many, stop plotting to save time.",
            "default": "3",
            "paramClass": "IntParam"
          },
          {
            "name": "crg_min_res_A",
            "label": "Minimum Fit Res (A)",
            "expertLevel": 0,
            "condition": "refine_ctf_global_refine == True",
            "_isImportant": False,
            "help": "The minimum resolution to use during refinement of image aberrations.",
            "default": "10",
            "paramClass": "FloatParam"
          },
          {
            "name": "crg_do_tilt",
            "label": "Fit Tilt",
            "expertLevel": 0,
            "condition": "refine_ctf_global_refine == True",
            "_isImportant": False,
            "help": "Whether to fit beam tilt.",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "crg_do_trefoil",
            "label": "Fit Trefoil",
            "expertLevel": 0,
            "condition": "refine_ctf_global_refine == True",
            "_isImportant": False,
            "help": "Whether to fit beam trefoil.",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "crg_do_spherical",
            "label": "Fit Spherical Aberration",
            "expertLevel": 0,
            "condition": "refine_ctf_global_refine == True",
            "_isImportant": False,
            "help": "Whether to fit spherical aberration.",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "crg_do_tetrafoil",
            "label": "Fit Tetrafoil",
            "expertLevel": 0,
            "condition": "refine_ctf_global_refine == True",
            "_isImportant": False,
            "help": "Whether to fit beam tetrafoil.",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "crg_compute_batch_size",
            "label": "GPU batch size of images",
            "expertLevel": 1,
            "condition": None,
            "_isImportant": False,
            "help": None,
            "default": None,
            "paramClass": "IntParam"
          }
        ]
      },
      {
        "label": "Ewald Sphere Correction",
        "params": [
          {
            "name": "refine_do_ews_correct",
            "label": "Do EWS correction",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Whether or not to correct for the curvature of the Ewald Sphere.",
            "default": "False",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_do_ews_correct_align",
            "label": "Do EWS correction in alignment",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Whether or not to correct for the curvature of the Ewald Sphere.",
            "default": "False",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_ews_zsign",
            "label": "EWS curvature sign",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Whether to use positive or negative curvature in Ewald Sphere correction.",
            "default": "0",
            "display": 1,
            "choices": [
              "positive",
              "negative"
            ],
            "paramClass": "EnumParam"
          },
          {
            "name": "refine_ews_simple",
            "label": "EWS correction method",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Whether to use the simple insertion method, or to use an iterative optimization method, for Ewald Sphere correction.",
            "default": "0",
            "display": 1,
            "choices": [
              "simple",
              "iterative"
            ],
            "paramClass": "EnumParam"
          }
        ]
      },
      {
        "label": "Compute settings",
        "params": [
          {
            "name": "compute_use_ssd",
            "label": "Cache particle images on SSD",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Whether or not to copy particle images to the local SSD before running. The cache is persistent, so after caching once, particles should be available for subsequent jobs that require the same data. Not using an SSD can dramatically slow down processing.",
            "default": "False",
            "paramClass": "BooleanParam"
          },
          {
            "name": "compute_lane",
            "label": "Lane name:",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "The scheduler lane name to add the protocol execution",
            "default": "default",
            "paramClass": "StringParam"
          }
        ]
      },
      {
        "label": "Advanced Refinement",
        "params": [
          {
            "name": "refine_do_marg",
            "label": "Adaptive Marginalization",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Efficiently marginalize over poses and shifts using an auto-tuning adaptive sampling strategy. Can improve results on small molecules.",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_nu_enable",
            "label": "Non-uniform refine enable",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Enable cross-validation-optimal non-uniform regularization during refinement.",
            "default": "True",
            "paramClass": "BooleanParam"
          },
          {
            "name": "refine_nu_filtertype",
            "label": "Non-uniform filter type",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "butterworth, rect, or gaussian",
            "default": "0",
            "display": 1,
            "choices": [
              "butterworth",
              "rect",
              "gaussian"
            ],
            "paramClass": "EnumParam"
          },
          {
            "name": "refine_nu_order",
            "label": "Non-uniform filter order",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Order of the butterworth filter used for cross-validation-optimal regularization. Default to 8, probably no need to change this.",
            "default": "8",
            "paramClass": "IntParam"
          },
          {
            "name": "refine_nu_awf",
            "label": "Non-uniform AWF",
            "expertLevel": 0,
            "condition": None,
            "_isImportant": False,
            "help": "Adaptive Window Factor for cross-validation-optimal regularization. Trade off between fast transitions between regions (AWF should be lower) and more accurate local cross-validation test (AWF should be higher). Default of 3 is good, can try as low as 1.5 ",
            "default": "3",
            "paramClass": "FloatParam"
          }
        ]
      }
    ]
  },
  "values": {
    "runName": "protNonUniform3DRefinement_1",
    "_objComment": "",
    "_useQueue": False,
    "_prerequisites": [],
    "gpuList": "0",
    "expertLevel": "Normal",
    "runMode": "Continue",
    "inputParticles": "2.outputParticles",
    "referenceVolume": "79.outputVolume",
    "refMask": "",
    "symmetryGroup": "Cn (Cn)",
    "symmetryOrder": 1,
    "refine_symmetry_do_align": True,
    "refine_do_init_scale_est": True,
    "refine_num_final_iterations": 0,
    "refine_res_init": 30,
    "refine_res_gsfsc_split": 20,
    "refine_highpass_res": "",
    "refine_clip": False,
    "refine_window": True,
    "refine_skip_premult": True,
    "refine_ignore_dc": True,
    "refine_batchsize_init": 0,
    "refine_batchsize_epsilon": 0.001,
    "refine_batchsize_snrfactor": 40,
    "refine_scale_min": False,
    "refine_scale_start_iter": 0,
    "refine_noise_model": "symmetric",
    "refine_noise_priorw": 50,
    "refine_noise_initw": 200,
    "refine_noise_init_sigmascale": 3,
    "refine_mask": "dynamic",
    "refine_dynamic_mask_thresh_factor": 0.2,
    "refine_dynamic_mask_near_ang": 6,
    "refine_dynamic_mask_far_ang": 14,
    "refine_dynamic_mask_start_res": 12,
    "refine_dynamic_mask_use_abs": False,
    "refine_compute_batch_size": "",
    "refine_defocus_refine": False,
    "crl_num_plots": 3,
    "crl_min_res_A": 20,
    "crl_df_range": 2000,
    "crl_compute_batch_size": "",
    "refine_ctf_global_refine": False,
    "crg_num_plots": 3,
    "crg_min_res_A": 10,
    "crg_do_tilt": True,
    "crg_do_trefoil": True,
    "crg_do_spherical": True,
    "crg_do_tetrafoil": True,
    "crg_compute_batch_size": "",
    "refine_do_ews_correct": False,
    "refine_do_ews_correct_align": False,
    "refine_ews_zsign": "positive",
    "refine_ews_simple": "simple",
    "compute_use_ssd": False,
    "compute_lane": "default",
    "refine_do_marg": True,
    "refine_nu_enable": True,
    "refine_nu_filtertype": "butterworth",
    "refine_nu_order": 8,
    "refine_nu_awf": 3
  }
}
}
