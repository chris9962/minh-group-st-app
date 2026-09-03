import { can, canOpenBankAdmin } from '@/lib/permissions';
import type { DocArticle } from '../types';

/**
 * Các màn Cấu hình — mỗi bài trả lời hai câu: màn này đổi cái gì trong hệ
 * thống, và thao tác từng bước ra sao. Điều kiện hiện bài trùng điều kiện hiện
 * mục sidebar tương ứng ở `lib/nav.ts`.
 */
export const CONFIG_DOCS: DocArticle[] = [
  {
    slug: 'them-ma-gioi-thieu',
    title: 'Thêm mã giới thiệu',
    screen: 'P-61',
    group: 'config',
    summary: 'Nạp mã mới vào kho để nhân viên dùng khi mở tài khoản ngân hàng.',
    keywords: [
      'thêm mã giới thiệu',
      'mã giới thiệu',
      'kho mã',
      'referral',
      'hết mã',
      'lượt dùng',
      'không gợi ý mã',
      'mã cho phòng',
      'hết lượt',
      'đang giữ',
    ],
    visibleTo: canOpenBankAdmin,
    blocks: [
      {
        kind: 'text',
        body: 'Nhân viên gắn mã giới thiệu vào tài khoản ngân hàng lúc mở. Kho mã quyết định hệ thống gợi ý mã nào cho họ.',
      },
      {
        kind: 'text',
        body: 'Mỗi mã thuộc đúng một ngân hàng. Mỗi mã có một tổng số lượt dùng. Bản nháp chiếm chỗ ngay khi nhân viên tạo, và chỗ đó nằm ở cột **Đang giữ**. Nhân viên hoàn thành tài khoản thì chỗ chuyển sang cột **Đã dùng**.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/referral-codes-page.png',
          alt: 'Màn Ngân hàng và mã giới thiệu, tab Kho mã giới thiệu',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 92.3, label: 'Đường vào: Cấu hình → Ngân hàng & mã giới thiệu.' },
            { n: 2, x: 38.5, y: 13.8, label: 'Tab Kho mã giới thiệu.' },
            { n: 3, x: 93.2, y: 4.1, label: 'Nút Thêm mã.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở **Cấu hình → Ngân hàng & mã giới thiệu**.',
          'Chuyển sang tab **Kho mã giới thiệu**.',
          'Bấm **Thêm mã** ở góc trên bên phải.',
          'Chọn **Ngân hàng**.',
          'Nhập **Mã giới thiệu**, ví dụ VPA-2026-01.',
          'Chọn **Tỉnh** và nhập **Chi nhánh hỗ trợ**.',
          'Nhập **Tổng số lượt dùng** và **Độ ưu tiên**.',
          'Ngân hàng dùng mã QR thì bạn tải thêm **Ảnh QR**.',
          'Chọn **Phạm vi sử dụng**: mọi phòng, hoặc chỉ những phòng bạn chọn.',
          'Bấm **Tạo mã**.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/referral-code-form.png',
          alt: 'Biểu mẫu Thêm mã giới thiệu',
          width: 560,
          height: 736,
          markers: [
            { n: 1, x: 50, y: 13.3, label: 'Ngân hàng của mã — mỗi mã thuộc đúng một ngân hàng.' },
            { n: 2, x: 50, y: 23.7, label: 'Chuỗi mã, ví dụ VPA-2026-01.' },
            { n: 3, x: 50, y: 54.7, label: 'Tổng số lượt dùng.' },
            { n: 4, x: 50, y: 68.4, label: 'Độ ưu tiên — mã cao hơn đứng trước trong danh sách gợi ý.' },
            { n: 5, x: 89.1, y: 95.1, label: 'Nút Tạo mã — nạp mã vào kho.' },
          ],
        },
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Ô **Phạm vi sử dụng** nằm ngay trên nút Tạo mã. Bạn cuộn xuống để thấy.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Mã hết chỗ thì hệ thống không gợi ý nữa. Bạn nạp mã mới hoặc nâng tổng số lượt. Nhân viên xoá bản nháp thì chỗ quay lại kho.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bạn chỉ quản vài ngân hàng thì mục trên thanh điều hướng tên **Ngân hàng phụ trách**.',
      },
    ],
  },
  {
    slug: 'danh-sach-ngan-hang',
    title: 'Danh sách ngân hàng',
    screen: 'P-60',
    group: 'config',
    summary: 'Thêm và sửa ngân hàng công ty đang triển khai.',
    keywords: [
      'ngân hàng',
      'thêm ngân hàng',
      'sửa ngân hàng',
      'tắt ngân hàng',
      'quản ngân hàng',
      'ngân hàng phụ trách',
      'ngân hàng không hiện',
      'phân công ngân hàng',
    ],
    visibleTo: canOpenBankAdmin,
    blocks: [
      {
        kind: 'text',
        body: 'Bảng này là danh sách ngân hàng công ty đang triển khai. Ngân hàng tắt không hiện trong hộp thoại mở tài khoản. Dữ liệu tài khoản cũ giữ nguyên.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/banks-page.png',
          alt: 'Màn Ngân hàng và mã giới thiệu, tab Danh sách ngân hàng',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 26.8, y: 13.8, label: 'Tab Danh sách ngân hàng.' },
            { n: 2, x: 91.2, y: 4.1, label: 'Nút Thêm ngân hàng — chỉ người quản mọi ngân hàng thấy.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở **Cấu hình → Ngân hàng & mã giới thiệu**. Trang mở sẵn tab **Danh sách ngân hàng**.',
          'Bấm **Thêm ngân hàng** để thêm ngân hàng mới.',
          'Sửa một ngân hàng thì bạn bấm nút hình bút chì ở cột **Thao tác**.',
          'Trong hộp thoại sửa, bạn gán người phụ trách ngân hàng đó.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Có hai mức quyền. Quyền "Quản lý mọi ngân hàng & mã giới thiệu" thấy đủ mọi ngân hàng và thêm được ngân hàng mới. Quyền "Quản lý ngân hàng được giao" chỉ thấy và sửa ngân hàng mình phụ trách.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bạn chỉ quản vài ngân hàng thì mục trên thanh điều hướng tên **Ngân hàng phụ trách**.',
      },
    ],
  },
  {
    slug: 'quy-tac-qua',
    title: 'Quy tắc quà & điểm',
    screen: 'P-81',
    group: 'config',
    summary: 'Thử một tình huống khách để xem hệ thống trả quà nào và bao nhiêu điểm.',
    keywords: [
      'quy tắc quà',
      'thể lệ',
      'quà tặng',
      'thử quà',
      'danh sách quà',
      'khách được quà gì',
      'điều kiện nhận quà',
      'CNKD',
    ],
    visibleTo: (user) => can(user, 'system', 'configure-gift-rules'),
    blocks: [
      {
        kind: 'text',
        body: 'Màn này chỉ để xem thử. Bạn không sửa được thể lệ ở đây.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/gift-rules-page.png',
          alt: 'Màn Quy tắc quà & điểm với khối Nút thử',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 70.9, label: 'Đường vào: Cấu hình → Quy tắc quà & điểm.' },
            { n: 2, x: 60.8, y: 15.2, label: 'Khối Nút thử — nhập tình huống khách.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở **Cấu hình → Quy tắc quà & điểm**.',
          'Ở khối **Nút thử**, bạn tích các ngân hàng khách đã mở.',
          'Chọn **Phòng của người phụ trách** và **Kênh**.',
          'Chọn **Ngày tra luật**.',
          'Hệ thống hiện danh sách quà khách đủ điều kiện nhận, kèm số điểm.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Thể lệ thật nằm trong mã nguồn theo từng kỳ. Đổi thể lệ thì đội kỹ thuật phải sửa và cài bản mới. Bạn báo đội kỹ thuật trước khi kỳ mới bắt đầu.',
      },
    ],
  },
  {
    slug: 'danh-muc-qua-goi-bao-hiem',
    title: 'Danh mục quà & gói BH',
    screen: 'P-82',
    group: 'config',
    summary: 'Bật tắt món quà và gói bảo hiểm hiện ra khi tạo đơn.',
    keywords: [
      'danh mục quà',
      'gói bảo hiểm',
      'thêm gói',
      'thêm quà',
      'tắt gói',
      'vật phẩm',
      'gói không hiện',
      'thiếu gói',
      'bật gói',
    ],
    visibleTo: (user) => can(user, 'system', 'configure-catalog'),
    blocks: [
      {
        kind: 'text',
        body: 'Màn này có hai bảng. Bảng **Vật phẩm** là các món quà dùng khi phát quà. Bảng **Gói bảo hiểm** là các gói hiện trong hộp thoại tạo đơn.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/gift-catalog-page.png',
          alt: 'Màn Danh mục quà và gói bảo hiểm với hai bảng',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 75.9, label: 'Đường vào: Cấu hình → Danh mục quà & gói BH.' },
            { n: 2, x: 39.6, y: 15.2, label: 'Bảng Vật phẩm — món quà dùng khi phát quà.' },
            { n: 3, x: 79, y: 15.2, label: 'Bảng Gói bảo hiểm — gói hiện khi tạo đơn.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở **Cấu hình → Danh mục quà & gói BH**.',
          'Thêm món quà: bạn gõ vào ô **Tên vật phẩm mới** dưới bảng Vật phẩm rồi bấm **Thêm**.',
          'Thêm gói: bạn bấm **Thêm gói bảo hiểm** ở chân bảng Gói bảo hiểm.',
          'Sửa một gói: bạn bấm nút hình bút chì ở cột **Thao tác**.',
          'Ngừng dùng một mục: bạn bấm **Ngừng**, rồi xác nhận. Dùng lại thì bấm **Dùng lại**.',
        ],
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Bảng Vật phẩm không sửa được tên. Bạn muốn đổi tên một món thì ngừng món cũ và thêm món mới.',
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bạn không chọn được mục đã ngừng khi tạo mới. Bản ghi cũ giữ nguyên.',
      },
    ],
  },
  {
    slug: 'chi-tieu-kpi',
    title: 'Chỉ tiêu KPI',
    screen: 'P-83',
    group: 'config',
    summary: 'Đặt mốc điểm tháng chung cho toàn công ty.',
    keywords: [
      'chỉ tiêu',
      'KPI',
      'mốc điểm',
      'chỉ tiêu tháng',
      'mục tiêu tháng',
      'định mức',
      'đổi chỉ tiêu',
    ],
    visibleTo: (user) => can(user, 'system', 'configure-catalog'),
    blocks: [
      {
        kind: 'text',
        body: 'Một con số cho toàn công ty: mốc điểm mỗi nhân viên phải đạt trong tháng. Nhân viên mở màn Tổng quan thì thấy phần trăm hoàn thành của chính mình tính theo số này.',
      },
      {
        kind: 'note',
        tone: 'warning',
        body: 'Bạn bấm lưu là thay con số của cả công ty. Màn này chỉ ghi cho tháng hiện tại, tháng cũ không sửa được.',
      },
      {
        kind: 'steps',
        items: [
          'Mở **Cấu hình → Chỉ tiêu KPI**.',
          'Nhập **Chỉ tiêu điểm mỗi tháng**.',
          'Bấm **Lưu chỉ tiêu**.',
        ],
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/kpi-target-page.png',
          alt: 'Màn Chỉ tiêu KPI',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 81, label: 'Đường vào: Cấu hình → Chỉ tiêu KPI.' },
            { n: 2, x: 42.4, y: 24.2, label: 'Mốc điểm tháng chung cho toàn công ty.' },
            { n: 3, x: 26.4, y: 30.5, label: 'Nút Lưu chỉ tiêu.' },
          ],
        },
      },
    ],
  },
  {
    slug: 'loai-dich-vu',
    title: 'Loại dịch vụ',
    screen: 'P-84',
    group: 'config',
    summary: 'Quản lý danh mục loại dịch vụ và hệ số điểm KPI của từng loại.',
    keywords: [
      'loại dịch vụ',
      'hệ số điểm',
      'thêm loại dịch vụ',
      'tắt loại dịch vụ',
      'đổi hệ số điểm',
    ],
    visibleTo: (user) => can(user, 'system', 'configure-catalog'),
    blocks: [
      {
        kind: 'text',
        body: 'Mỗi loại dịch vụ mang một hệ số điểm KPI. Nhân viên ghi một lượt dịch vụ thì hệ thống tính điểm theo hệ số của loại đó.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/service-types-page.png',
          alt: 'Màn Loại dịch vụ',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 86, label: 'Đường vào: Cấu hình → Loại dịch vụ.' },
            { n: 2, x: 91, y: 4.1, label: 'Nút Thêm loại dịch vụ.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở **Cấu hình → Loại dịch vụ**.',
          'Bấm **Thêm loại dịch vụ** để thêm loại mới.',
          'Sửa tên hoặc hệ số: bạn bấm nút hình bút chì ở cột **Thao tác**.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        body: 'Bạn không chọn được loại đã ngừng khi ghi dịch vụ mới.',
      },
    ],
  },
  {
    slug: 'danh-muc-kenh',
    title: 'Danh mục kênh',
    screen: 'P-70',
    group: 'config',
    summary: 'Thêm kênh nguồn khách, thêm xã/ấp và bệnh viện cho kênh cần chúng.',
    keywords: [
      'kênh',
      'danh mục kênh',
      'ấp',
      'xã',
      'bệnh viện',
      'nguồn khách',
      'không tìm thấy ấp',
      'thiếu xã',
      'thêm bệnh viện',
      'thêm tỉnh',
    ],
    visibleTo: (user) => can(user, 'system', 'configure-catalog'),
    blocks: [
      {
        kind: 'text',
        body: 'Kênh là nguồn khách đến. Kênh hiện ở ô **Kênh (tuỳ chọn)** của hồ sơ khách.',
      },
      {
        kind: 'text',
        body: 'Màn này có thêm hai danh mục. Kênh Ấp và kênh Định danh lấy địa bàn từ danh mục xã/ấp. Kênh Bệnh viện lấy tên từ danh mục bệnh viện.',
      },
      {
        kind: 'shot',
        shot: {
          src: '/docs/channels-page.png',
          alt: 'Màn Danh mục kênh',
          width: 1280,
          height: 800,
          markers: [
            { n: 1, x: 9.2, y: 98.5, label: 'Đường vào: Cấu hình → Danh mục kênh.' },
            { n: 2, x: 59.1, y: 15.2, label: 'Bảng kênh nguồn khách.' },
            { n: 3, x: 57.1, y: 80.7, label: 'Danh mục xã/ấp — địa bàn cho kênh Ấp và kênh Định danh.' },
          ],
        },
      },
      {
        kind: 'steps',
        items: [
          'Mở **Cấu hình → Danh mục kênh**.',
          'Thêm hoặc sửa kênh ở bảng trên cùng.',
          'Thêm địa bàn mới: bạn thêm tỉnh trước, rồi thêm xã, rồi thêm ấp.',
          'Thêm bệnh viện: bạn cuộn xuống khối **Danh mục bệnh viện** ở cuối trang.',
        ],
      },
    ],
  },
];
