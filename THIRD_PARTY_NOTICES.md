# Third-party notices

Bozzetto itself is MIT-licensed; see [LICENSE](LICENSE). It ships the
third-party code and assets below, in the web app (the site, the installed
app and exported single-file pages). Each entry says
what ships, under which licence, and carries the notice text that licence
asks to be kept with copies.

Build tools that do not end up in what ships (TypeScript, Vite, Wrangler
and the rest of `devDependencies`) are not listed.

## Code

### three.js

`three` 0.186.1, <https://threejs.org/>. MIT.

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### SculptGL (vendored, modified)

Sculpt mode's editing core, from <https://github.com/stephomi/sculptgl>,
vendored and modified in `src/sculpt/vendor/` (its licence is
`src/sculpt/vendor/LICENSE`). MIT.

```text
MIT License

Copyright (c) 2019 Stéphane GINIER

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### gl-matrix

`gl-matrix` 3.4.4, <https://glmatrix.net>, used by the SculptGL core. MIT.

```text
Copyright (c) 2015-2025, Brandon Jones, Colin MacKenzie IV.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### gifenc

`gifenc` 1.0.3, <https://github.com/mattdesl/gifenc>, the GIF export. MIT.

```text
The MIT License (MIT)
Copyright (c) 2017 Matt DesLauriers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.
```

### Mediabunny

`mediabunny` 1.48.1, <https://mediabunny.dev/>, the MP4 export. Mozilla
Public License 2.0.

```text
Copyright (c) 2026-present, Vanilagy and contributors

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
```

Bozzetto uses Mediabunny unmodified, exactly as published on npm. Its
Source Code Form is available from the project's repository at
<https://github.com/Vanilagy/mediabunny/tree/v1.48.1> and from the npm
package <https://www.npmjs.com/package/mediabunny/v/1.48.1>. The full text of
the licence is at <https://mozilla.org/MPL/2.0/>. The MPL covers Mediabunny's
files only; it does not extend to the rest of Bozzetto.

### Uicons by Flaticon

`@flaticon/flaticon-uicons` 3.3.1, <https://www.flaticon.com/uicons>: the
sculpt toolbar's icon font (solid straight and thin straight). Also
`src/sculpt/ui/icons/flatten.svg`, Flaticon's "scraper" icon (19010200).
Used under the Flaticon License, free of charge with attribution:

**Icons: Uicons by [Flaticon](https://www.flaticon.com/uicons).**

The licence text shipped in the npm package:

```text
Flaticon License

By means of these Terms, the Company grants the User a Flaticon License under which the User is authorized to download, use and modify the Flaticon Content on a device owned or controlled by the User on a non-transferable, limited, exclusive, revocable and worldwide basis for the entire duration of the rights and solely for the purposes and uses authorized under these Terms.

Without prejudice to the provisions set forth in paragraph 3 of this clause, the User of a Flaticon License may use the content in the Flaticon Content, provided that the Flaticon Content is not used in printed or electronic items (e.g. t-shirts, cups, postcards, birthday or greeting cards, invitations, calendars, web models or electronic devices, apps, NFTs, videogames, advertising spots, audiovisual animations) aimed to be resold, in which the Flaticon Content is the main element (because of size, relevance or any other cause, in case of doubt about whether the content is main element, it shall be deemed that the content is main element);

Furthermore, the authorization to use the content in the Flaticon Content shall be free of charge under the Flaticon License where any use thereof by the User is done by duly crediting said content to the Website/Company and, in any event, to the Collaborator, as stated by the Company from time to time. In order to benefit from the Service of using the Flaticon Content without the aforementioned crediting, the User must purchase a subscription (hereinafter the "Premium Subscription") from the Website and download the relevant Flaticon Content during the term of said Premium Subscription. The terms set forth in Section 9 shall apply to the purchase of the Premium Subscription.

Where any content of the Flaticon Content is marked or identified as being for editorial use, or where within the same there are distinctive signs, recognizable products, public buildings, public events or images taken in places where recognizable persons appear in the background, the User shall only be entitled to use it for such editorial use; in other words, for purposes related to exercising freedom of expression and the right to information or for academic or educational purposes. More specifically, this means that the User undertakes not to use said content in any way that could imply a link to any business activity, use in the course of trade or the advertising, promotion or marketing of any product or service. In addition, the User shall ensure that any use for educational purposes is allowed under any legislation which applies and shall fulfill any requirements set forth by such legislation, including, but not limited to, citation obligations or limitations on the extent or purpose of said use. The User shall be directly liable for, and the Company shall not assume any liability resulting from the use for commercial purposes by the User of any content in the Flaticon Content whose use must be limited to editorial use as set forth in this paragraph or as a consequence of any editorial use that is contrary to the legislation which applies.

More information about the Term and Conditions of use on https://www.freepikcompany.com/legal?#nav-flaticon
```

### SimpleWebAuthn

Passkeys are handled by `@simplewebauthn/browser` (in the web app) and
`@simplewebauthn/server` (in the Functions), both by Matthew Miller. MIT.

```text
MIT License

Copyright (c) 2020 Matthew Miller

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### client-zip

"Download my data" and the frames zips are assembled in the browser by
`client-zip`, by David Junger <tffy@free.fr>. MIT.

```text
Copyright 2020 David Junger

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### QuadriFlow (web app only, compiled to WebAssembly)

Sculpt's **Quad remesh** runs QuadriFlow, by Jingwei Huang, Yichao Zhou,
Matthias Niessner, Jonathan Shewchuk and Leonidas Guibas,
<https://github.com/hjwdzh/QuadriFlow> at commit 810b7a0, compiled with
Emscripten into `public/quadriflow/quadriflow.wasm` and its loader
`quadriflow.mjs` by `tools/quadriflow-wasm/build.sh`, with a small entry
point of Bozzetto's own (`tools/quadriflow-wasm/qf_wasm.cpp`, MIT like the
rest of Bozzetto). The two files are fetched the first time a quad remesh
runs. BSD-3-Clause, with the authors' note on enhancements:

```text
Copyright (c) 2018 Jingwei Huang, Yichao Zhou, Matthias Niessner,
Jonathan Shewchuk and Leonidas Guibas. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

You are under no obligation whatsoever to provide any bug fixes, patches, or
upgrades to the features, functionality or performance of the source code
("Enhancements") to anyone; however, if you choose to make your Enhancements
available either publicly, or directly to the authors of this software, without
imposing a separate written license agreement for such Enhancements, then you
hereby grant the following license: a non-exclusive, royalty-free perpetual
license to install, use, modify, prepare derivative works, incorporate into
other computer software, distribute, and sublicense such enhancements or
derivative works thereof, in binary and source code form.
```

Compiled in with it, from QuadriFlow's `3rd/` folder and the system's
headers:

#### LEMON 1.3.1

QuadriFlow's `3rd/lemon-1.3.1`, the graph library behind its flow
solvers (`lemon/base.cc` and the headers its flow code includes). Boost
Software License 1.0, as its LICENSE file says:

```text
LEMON code without an explicit copyright notice is covered by the following
copyright/license.

Copyright (C) 2003-2012 Egervary Jeno Kombinatorikus Optimalizalasi
Kutatocsoport (Egervary Combinatorial Optimization Research Group,
EGRES).

===========================================================================
Boost Software License, Version 1.0
===========================================================================

Permission is hereby granted, free of charge, to any person or organization
obtaining a copy of the software and accompanying documentation covered by
this license (the "Software") to use, reproduce, display, distribute,
execute, and transmit the Software, and to prepare derivative works of the
Software, and to permit third-parties to whom the Software is furnished to
do so, all subject to the following:

The copyright notices in the Software and this entire statement, including
the above license grant, this restriction and the following disclaimer,
must be included in all copies of the Software, in whole or in part, and
all derivative works of the Software, unless such copies or derivative
works are solely in the form of machine-executable object code generated by
a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT
SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE
FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

#### pcg32

QuadriFlow's `3rd/pcg32/pcg32.h`, Wenzel Jakob's small version of Melissa
O'Neill's PCG random number generator. Apache License 2.0, as its header
says:

```text
/*
 * Tiny self-contained version of the PCG Random Number Generation for C++
 * put together from pieces of the much larger C/C++ codebase.
 * Wenzel Jakob, February 2015
 *
 * The PCG random number generator was developed by Melissa O'Neill <oneill@pcg-random.org>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * For additional information about the PCG random number generation scheme,
 * including its license and other licensing options, visit
 *
 *     http://www.pcg-random.org
 */
```

The licence in full:

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

#### Eigen 3.4.0

The linear algebra templates QuadriFlow is written in, <https://eigen.tuxfamily.org>,
compiled in from their headers with `EIGEN_MPL2_ONLY` defined, so only
the parts under the Mozilla Public License 2.0 are used. Eigen's source
code, which is what is under that licence here (Bozzetto changes none of
it), is at <https://gitlab.com/libeigen/eigen/-/tree/3.4.0>, and the
licence's text at <https://mozilla.org/MPL/2.0/>. Each of its files says:

```text
This Source Code Form is subject to the terms of the Mozilla
Public License v. 2.0. If a copy of the MPL was not distributed
with this file, You can obtain one at http://mozilla.org/MPL/2.0/.
```

#### Boost Graph Library (Boost 1.83 headers)

The Boykov-Kolmogorov maximum flow QuadriFlow solves its flows with
(`boost/graph/boykov_kolmogorov_max_flow.hpp`), the adjacency list it
works on and the Boost headers they include, <https://www.boost.org>.
Boost Software License 1.0:

```text
Boost Software License - Version 1.0 - August 17th, 2003

Permission is hereby granted, free of charge, to any person or
organization obtaining a copy of the software and accompanying
documentation covered by this license (the "Software") to use,
reproduce, display, distribute, execute, and transmit the
Software, and to prepare derivative works of the Software, and
to permit third-parties to whom the Software is furnished to do
so, all subject to the following:

The copyright notices in the Software and this entire statement,
including the above license grant, this restriction and the
following disclaimer, must be included in all copies of the
Software, in whole or in part, and all derivative works of the
Software, unless such copies or derivative works are solely in
the form of machine-executable object code generated by a source
language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND
NON-INFRINGEMENT. IN NO EVENT SHALL THE COPYRIGHT HOLDERS OR
ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE FOR ANY DAMAGES OR
OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```

#### Emscripten's runtime

The loader `quadriflow.mjs` is Emscripten's (6.0.13) JavaScript runtime,
and the wasm carries the parts of its system libraries the code uses:
musl's C library, LLVM's libc++, libc++abi and compiler-rt. Emscripten is
MIT (or the University of Illinois/NCSA licence, at the user's choice);
musl is MIT; libc++, libc++abi and compiler-rt are Apache-2.0 with the
LLVM exception, which asks for no notice in compiled code.

```text
Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

musl:

```text
Copyright © 2005-2020 Rich Felker, et al.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

#### Not compiled in

QuadriFlow's `3rd/pss` (Intel's parallel stable sort, BSD-3-Clause) is
included only with Intel TBB, which this build does not use, and its
`3rd/MapleCOMSPS_LRB` SAT solver is not built either; neither is in what
ships.

### Bundled with the Functions (server only)

The Functions bundle brings `@simplewebauthn/server`'s own
dependencies, which run on Cloudflare's servers and ship to no user:
`@peculiar/asn1-schema`, `@peculiar/asn1-x509` and `@peculiar/x509`
(MIT), `asn1js` (BSD-3-Clause), `reflect-metadata` (Apache-2.0) and
`tslib` (0BSD). Their licence texts are in `node_modules/` under each
package.

### Workbox (web app only)

The service worker that keeps the installed web app working offline is
generated by `vite-plugin-pwa` and runs Google's Workbox 7. MIT.

```text
Copyright 2018 Google LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Fonts

Instrument Serif, JetBrains Mono and Manrope, in `public/assets/fonts/`, are
under the SIL Open Font License 1.1. Each font's copyright line and the full
licence are in `public/assets/fonts/licenses/`, which ships beside the fonts.

## Models and images

### Human Base Meshes (Blender Studio)

The base meshes in `public/assets/basemeshes/` and the mannequins in
`public/assets/armature/` come from Blender Studio's Human Base Meshes bundle
v1.4.1, <https://www.blender.org/download/demo-files/#asset-bundles>, released
under CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>). CC0
asks for no notice; the credit is given anyway. Made by Dan Ulrich, Julien
Kaspar, Paul Kotelevets and Tonatiuh de San Julián. Each folder's
`LICENSE.txt` says which pieces came from whom and how they were exported.

### Environment maps (HDRIs)

The six environment maps in `public/assets/env/` are from
[Poly Haven](https://polyhaven.com/hdris), published under CC0 1.0
(public domain dedication), resized for the web and saved again from
Adobe Photoshop, which is why two of the files name it. CC0 asks for no
notice; the credit is given anyway.

- `studio-neutral.hdr` (Neutral studio; also precached by the installed web app)
- `studio-photo.hdr` (Photo studio)
- `overcast.hdr` (Soft overcast)
- `interior-warm.hdr` (Warm interior)
- `garage.hdr` (Garage)
- `plaza.hdr` (Outdoor plaza)

### Other images

The matcaps `vr01.png` to `vr10.png` in `public/assets/matcaps/` are the
owner's own work. `clay.png` is generated by `scripts/generate-sample.mjs`.
