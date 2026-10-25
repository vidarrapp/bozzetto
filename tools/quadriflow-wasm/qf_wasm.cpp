// QuadriFlow's pipeline (src/main.cpp at 810b7a0) as one call for the
// WebAssembly build. Input and output are OBJ files on Emscripten's
// in-memory file system, as the command-line tool uses them. Flow is
// solved with Boykov-Kolmogorov max flow (no -mcf, no -sat: the SAT
// step shells out to minisat, which a browser cannot run).

#include "config.hpp"
#include "field-math.hpp"
#include "optimizer.hpp"
#include "parametrizer.hpp"

#include <cstdio>
#include <emscripten.h>

using namespace qflow;

// Progress for the worker: stage index and name through a JS hook.
EM_JS(void, qf_stage, (int i, const char* name), {
  if (Module.onStage) Module.onStage(i, UTF8ToString(name));
});

extern "C" EMSCRIPTEN_KEEPALIVE int qf_run(const char* in_obj, const char* out_obj, int faces,
                                           int sharp, int boundary, int adaptive, int seed) {
  Parametrizer* field = new Parametrizer();
  field->flag_preserve_sharp = sharp ? 1 : 0;
  field->flag_preserve_boundary = boundary ? 1 : 0;
  field->flag_adaptive_scale = adaptive ? 1 : 0;
  field->flag_minimum_cost_flow = 0;
  field->flag_aggresive_sat = 0;
  field->hierarchy.rng_seed = seed;

  qf_stage(0, "load");
  field->Load(in_obj);
  qf_stage(1, "initialize");
  field->Initialize(faces);

  if (field->flag_preserve_boundary) {
    Hierarchy& mRes = field->hierarchy;
    mRes.clearConstraints();
    for (uint32_t i = 0; i < 3 * mRes.mF.cols(); ++i) {
      if (mRes.mE2E[i] == -1) {
        uint32_t i0 = mRes.mF(i % 3, i / 3);
        uint32_t i1 = mRes.mF((i + 1) % 3, i / 3);
        Vector3d p0 = mRes.mV[0].col(i0), p1 = mRes.mV[0].col(i1);
        Vector3d edge = p1 - p0;
        if (edge.squaredNorm() > 0) {
          edge.normalize();
          mRes.mCO[0].col(i0) = p0;
          mRes.mCO[0].col(i1) = p1;
          mRes.mCQ[0].col(i0) = mRes.mCQ[0].col(i1) = edge;
          mRes.mCQw[0][i0] = mRes.mCQw[0][i1] = mRes.mCOw[0][i0] = mRes.mCOw[0][i1] = 1.0;
        }
      }
    }
    mRes.propagateConstraints();
  }

  qf_stage(2, "orientations");
  Optimizer::optimize_orientations(field->hierarchy);
  field->ComputeOrientationSingularities();
  if (field->flag_adaptive_scale == 1) {
    qf_stage(3, "slope");
    field->EstimateSlope();
  }
  qf_stage(4, "scale");
  Optimizer::optimize_scale(field->hierarchy, field->rho, field->flag_adaptive_scale);
  field->flag_adaptive_scale = 1;
  qf_stage(5, "positions");
  Optimizer::optimize_positions(field->hierarchy, field->flag_adaptive_scale);
  field->ComputePositionSingularities();
  qf_stage(6, "index map");
  field->ComputeIndexMap();
  qf_stage(7, "write");
  field->OutputMesh(out_obj);
  delete field;
  return 0;
}
